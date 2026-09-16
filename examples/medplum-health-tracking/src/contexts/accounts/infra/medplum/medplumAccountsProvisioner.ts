// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, AccessPolicyResource, Bundle, Patient } from '@medplum/fhirtypes';
import type { AccountsProvisioner } from '../http/accountsHttpApp';

const FAMILY_RELATIONSHIP_EXTENSION =
  'https://family.example/fhir/StructureDefinition/self-reported-family-relationship';

type MedplumAccountsProvisionerOptions = {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly ownerPolicyIdByAccountId: ReadonlyMap<string, string>;
  readonly agentPolicyIdByAgentId: ReadonlyMap<string, string>;
  readonly onError?: (error: unknown) => void;
};

type CreateMinorProfileCommand = Parameters<AccountsProvisioner['createMinorProfile']>[0];
type ActivateOwnerAccessCommand = Parameters<NonNullable<AccountsProvisioner['activateOwnerAccess']>>[0];
type ActivateAgentAccessCommand = Parameters<NonNullable<AccountsProvisioner['activateAgentAccess']>>[0];
type DeactivateAgentAccessCommand = Parameters<NonNullable<AccountsProvisioner['deactivateAgentAccess']>>[0];
type DeactivateFamilyAccessCommand = Parameters<NonNullable<AccountsProvisioner['deactivateFamilyAccess']>>[0];

export function createMedplumAccountsProvisioner(options: MedplumAccountsProvisionerOptions): AccountsProvisioner {
  const request = createFhirRequester(options);

  return {
    async createMinorProfile(command: CreateMinorProfileCommand) {
      try {
        const query = new URLSearchParams({
          identifier: `${command.member.identifier.system}|${command.member.identifier.value}`,
          _count: '1',
        });
        const matches = await request<Bundle<Patient>>('GET', `Patient?${query.toString()}`);
        if ((matches.total ?? matches.entry?.length ?? 0) > 0) {
          return { ok: false, reason: 'IDENTIFIER_COLLISION' } as const;
        }

        const created = await request<Patient>('POST', 'Patient', {
          resourceType: 'Patient',
          identifier: [command.member.identifier],
          name: [command.member.name],
          birthDate: command.member.birthDate,
          extension: [
            {
              url: FAMILY_RELATIONSHIP_EXTENSION,
              extension: [
                { url: 'account-id', valueString: command.accountId },
                { url: 'relationship', valueCode: command.relationship },
              ],
            },
          ],
        });
        return { ok: true, memberId: created.id } as const;
      } catch (error) {
        options.onError?.(error);
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }
    },

    async activateOwnerAccess(command: ActivateOwnerAccessCommand) {
      const policyId = options.ownerPolicyIdByAccountId.get(command.accountId);
      return mutateOnePolicy(request, policyId, (rules) => addMemberRules(rules, command.memberId, false));
    },

    async activateAgentAccess(command: ActivateAgentAccessCommand) {
      const policyId = options.agentPolicyIdByAgentId.get(command.agentId);
      return mutateOnePolicy(request, policyId, (rules) => {
        let next = rules;
        for (const memberId of command.memberIds) {
          next = addMemberRules(next, memberId, true);
        }
        return command.tasks.includes('digitize-measurement')
          ? addRule(next, { resourceType: 'Provenance', interaction: ['create'] })
          : next;
      });
    },

    async deactivateAgentAccess(command: DeactivateAgentAccessCommand) {
      const policyId = options.agentPolicyIdByAgentId.get(command.agentId);
      return mutateOnePolicy(request, policyId, (rules) => removeMemberRules(rules, command.memberId));
    },

    async deactivateFamilyAccess(command: DeactivateFamilyAccessCommand) {
      const ownerPolicyId = options.ownerPolicyIdByAccountId.get(command.accountId);
      const agentPolicyIds = command.derivativeAgentIds.map((agentId) => options.agentPolicyIdByAgentId.get(agentId));
      if (!ownerPolicyId || agentPolicyIds.some((id) => !id)) {
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }

      const policyIds = [ownerPolicyId, ...(agentPolicyIds as string[])];
      let originals: AccessPolicy[] = [];
      let successfullyUpdated = 0;
      try {
        originals = await Promise.all(policyIds.map((id) => request<AccessPolicy>('GET', `AccessPolicy/${id}`)));
        for (const policy of originals) {
          const next = { ...policy, resource: removeMemberRules(policy.resource ?? [], command.memberId) };
          await request<AccessPolicy>('PUT', `AccessPolicy/${policy.id}`, next);
          successfullyUpdated += 1;
        }
        return { ok: true } as const;
      } catch (error) {
        options.onError?.(error);
        await Promise.all(
          originals
            .slice(0, successfullyUpdated)
            .map((original) =>
              request<AccessPolicy>('PUT', `AccessPolicy/${original.id}`, original).catch(() => undefined)
            )
        );
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }
    },
  };
}

function createFhirRequester(options: MedplumAccountsProvisionerOptions) {
  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(`fhir/R4/${path}`, options.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/fhir+json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Medplum ${method} ${path} failed with HTTP ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  };
}

async function mutateOnePolicy(
  request: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  policyId: string | undefined,
  mutate: (rules: AccessPolicyResource[]) => AccessPolicyResource[]
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' }> {
  if (!policyId) {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  try {
    const policy = await request<AccessPolicy>('GET', `AccessPolicy/${policyId}`);
    await request<AccessPolicy>('PUT', `AccessPolicy/${policyId}`, {
      ...policy,
      resource: mutate(policy.resource ?? []),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
}

function addMemberRules(rules: AccessPolicyResource[], memberId: string, createOnly: boolean): AccessPolicyResource[] {
  return addRule(
    addRule(rules, {
      resourceType: 'Patient',
      criteria: `Patient?_id=${memberId}`,
      interaction: ['read', 'search'],
    }),
    {
      resourceType: 'Observation',
      criteria: `Observation?subject=Patient/${memberId}`,
      interaction: createOnly ? ['create'] : ['create', 'read', 'search'],
    }
  );
}

function addRule(rules: AccessPolicyResource[], rule: AccessPolicyResource): AccessPolicyResource[] {
  return rules.some((candidate) => candidate.resourceType === rule.resourceType && candidate.criteria === rule.criteria)
    ? rules
    : [...rules, rule];
}

function removeMemberRules(rules: AccessPolicyResource[], memberId: string): AccessPolicyResource[] {
  const criteria = new Set([`Patient?_id=${memberId}`, `Observation?subject=Patient/${memberId}`]);
  return rules.filter((rule) => !rule.criteria || !criteria.has(rule.criteria));
}
