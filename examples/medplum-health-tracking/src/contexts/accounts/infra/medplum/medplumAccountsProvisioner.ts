// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, AccessPolicyResource, Bundle, Patient, RelatedPerson } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import type { AccountRequestContext } from '../../application/ports/accountRequestContext';
import type { AccountsProvisioner, CreateMinorProfileCommand } from '../../application/ports/accountsProvisioner';

const FAMILY_RELATIONSHIP_EXTENSION =
  'https://family.example/fhir/StructureDefinition/self-reported-family-relationship';

type MedplumAccountsProvisionerOptions = {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly ownerPolicyIdByAccountId: ReadonlyMap<string, string>;
  readonly agentPolicyIdByAgentId: ReadonlyMap<string, string>;
  readonly onError?: (error: unknown) => void;
};

export function createMedplumAccountsProvisioner(options: MedplumAccountsProvisionerOptions) {
  return {
    async createMinorProfile(command, context?: AccountRequestContext) {
      try {
        const created = await conditionalCreatePatient(options, context, {
          resourceType: 'Patient',
          identifier: [command.member.identifier],
          name: [{ ...command.member.name, given: [...command.member.name.given] }],
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
        if (!created.created) {
          return { ok: false, reason: 'IDENTIFIER_COLLISION' } as const;
        }
        await createRelatedPerson(options, context, command, created.patient);
        return { ok: true, memberId: created.patient.id } as const;
      } catch (error) {
        options.onError?.(error);
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }
    },

    async activateOwnerAccess(command, context?: AccountRequestContext) {
      const policyId = options.ownerPolicyIdByAccountId.get(command.accountId);
      return mutateOnePolicy(createFhirRequester(options, context), policyId, (rules) =>
        addMemberRules(rules, command.memberId, false)
      );
    },

    async activateAgentAccess(command, context?: AccountRequestContext) {
      const policyId = options.agentPolicyIdByAgentId.get(command.agentId);
      return mutateOnePolicy(createFhirRequester(options, context), policyId, (rules) => {
        let next = rules;
        for (const memberId of command.previousMemberIds) {
          next = removeMemberRules(next, memberId);
        }
        for (const memberId of command.memberIds) {
          next = addMemberRules(next, memberId, true);
        }
        return command.tasks.includes('digitize-measurement')
          ? addRule(next, { resourceType: 'Provenance', interaction: ['create'] })
          : next;
      });
    },

    async deactivateAgentAccess(command, context?: AccountRequestContext) {
      const policyId = options.agentPolicyIdByAgentId.get(command.agentId);
      return mutateOnePolicy(createFhirRequester(options, context), policyId, (rules) =>
        removeAgentMemberRules(rules, command.memberId)
      );
    },

    async deactivateFamilyAccess(command, context?: AccountRequestContext) {
      const request = createFhirRequester(options, context);
      const ownerPolicyId = options.ownerPolicyIdByAccountId.get(command.accountId);
      const agentPolicyIds = command.derivativeAgentIds.map((agentId) => options.agentPolicyIdByAgentId.get(agentId));
      if (!ownerPolicyId || !allDefined(agentPolicyIds)) {
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }

      const policyIds = [ownerPolicyId, ...agentPolicyIds];
      try {
        const originals = await Promise.all(policyIds.map((id) => request<AccessPolicy>('GET', `AccessPolicy/${id}`)));
        await request<Bundle>('POST', '', {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: originals.map((policy, index) => ({
            resource: {
              ...policy,
              resource:
                index === 0
                  ? removeMemberRules(policy.resource ?? [], command.memberId)
                  : removeAgentMemberRules(policy.resource ?? [], command.memberId),
            },
            request: { method: 'PUT', url: `AccessPolicy/${policy.id}` },
          })),
        });
        return { ok: true } as const;
      } catch (error) {
        options.onError?.(error);
        return { ok: false, reason: 'UNAVAILABLE' } as const;
      }
    },
  } satisfies AccountsProvisioner;
}

function allDefined<T>(values: readonly (T | undefined)[]): values is readonly T[] {
  return values.every((value) => value !== undefined);
}

async function createRelatedPerson(
  options: MedplumAccountsProvisionerOptions,
  context: AccountRequestContext | undefined,
  command: CreateMinorProfileCommand,
  patient: Patient
): Promise<void> {
  const response = await fetch(new URL('fhir/R4/RelatedPerson', options.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/fhir+json',
      ...correlationHeaders(context?.correlationTraceId),
    },
    body: JSON.stringify({
      resourceType: 'RelatedPerson',
      patient: { reference: `Patient/${patient.id}` },
      identifier: [{ system: 'https://family.example/identity/keycloak-sub', value: command.accountId }],
      relationship: [
        {
          coding: [
            {
              system: 'https://family.example/fhir/CodeSystem/self-reported-family-relationship',
              code: command.relationship,
            },
          ],
        },
      ],
    } satisfies RelatedPerson),
  });
  if (!response.ok) {
    throw new Error(`Medplum RelatedPerson create failed with HTTP ${response.status}: ${await response.text()}`);
  }
}

async function conditionalCreatePatient(
  options: MedplumAccountsProvisionerOptions,
  context: AccountRequestContext | undefined,
  patient: Patient
): Promise<{ readonly created: boolean; readonly patient: Patient }> {
  const identifier = patient.identifier?.[0];
  if (!identifier?.system || !identifier.value) {
    throw new Error('Conditional Patient creation requires a complete identifier');
  }
  const response = await fetch(new URL('fhir/R4/Patient', options.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/fhir+json',
      'if-none-exist': `identifier=${identifier.system}|${identifier.value}`,
      ...correlationHeaders(context?.correlationTraceId),
    },
    body: JSON.stringify(patient),
  });
  if (!response.ok) {
    throw new Error(`Medplum conditional Patient create failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return { created: response.status === 201, patient: (await response.json()) as Patient };
}

function createFhirRequester(options: MedplumAccountsProvisionerOptions, context?: AccountRequestContext) {
  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(`fhir/R4/${path}`, options.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        ...correlationHeaders(context?.correlationTraceId),
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

function correlationHeaders(traceId: string | undefined): Record<string, string> {
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) {
    return {};
  }
  const spanId = randomUUID().replaceAll('-', '').slice(0, 16);
  return { traceparent: `00-${traceId.toLowerCase()}-${spanId}-01` };
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

function removeAgentMemberRules(rules: AccessPolicyResource[], memberId: string): AccessPolicyResource[] {
  const next = removeMemberRules(rules, memberId);
  const hasGrantedMember = next.some(
    (rule) => rule.resourceType === 'Observation' && rule.criteria?.startsWith('Observation?subject=Patient/')
  );
  return hasGrantedMember
    ? next
    : next.filter(
        (rule) =>
          !(
            rule.resourceType === 'Provenance' &&
            rule.criteria === undefined &&
            rule.interaction?.length === 1 &&
            rule.interaction[0] === 'create'
          )
      );
}
