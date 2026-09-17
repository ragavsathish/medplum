// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, Bundle, Patient, RelatedPerson, Resource } from '@medplum/fhirtypes';
import type { AccountsRepository } from '../../application/ports/accountsRepository';
import type { Account, AgentGrant, AgentTask } from '../../domain/account';

type Options = {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly accountIdentifierSystem: string;
  readonly ownerPolicyIdByAccountId: ReadonlyMap<string, string>;
  readonly agentPolicyIdByAgentId: ReadonlyMap<string, string>;
};

/** Reads Accounts state from Medplum resources. save is intentionally a no-op: resource mutations belong to the provisioner. */
export function createMedplumAccountsState(options: Options): AccountsRepository {
  return {
    async find(accountId: string): Promise<Account | undefined> {
      const selfMembers = await search<Patient>(options, 'Patient', {
        identifier: `${options.accountIdentifierSystem}|${accountId}`,
        _count: '2',
      });
      if (selfMembers.length !== 1 || !selfMembers[0].id) {
        return undefined;
      }
      const selfMemberId = selfMembers[0].id;
      const related = await search<RelatedPerson>(options, 'RelatedPerson', {
        identifier: `${options.accountIdentifierSystem}|${accountId}`,
      });
      const minorProfileIds = new Set(
        related.map((resource) => referenceId(resource.patient?.reference)).filter((id): id is string => !!id)
      );
      const ownerPolicyId = options.ownerPolicyIdByAccountId.get(accountId);
      const ownerPolicy = ownerPolicyId ? await read<AccessPolicy>(options, 'AccessPolicy', ownerPolicyId) : undefined;
      const linkedMemberIds = memberIdsFromPolicy(ownerPolicy);
      linkedMemberIds.delete(selfMemberId);
      const agentGrants = new Map<string, AgentGrant>();
      for (const [agentId, policyId] of options.agentPolicyIdByAgentId) {
        const policy = await read<AccessPolicy>(options, 'AccessPolicy', policyId);
        const memberIds = memberIdsFromPolicy(policy);
        if (memberIds.size) agentGrants.set(agentId, { memberIds, tasks: tasksFromPolicy(policy) });
      }
      return { accountId, selfMemberId, minorProfileIds, linkedMemberIds, agentGrants };
    },
    async save(): Promise<void> {
      // Medplum resources are the source of truth. The provisioner performs writes before this point.
    },
  };
}

async function search<T extends Resource>(
  options: Options,
  resourceType: T['resourceType'],
  parameters: Record<string, string>
): Promise<T[]> {
  const query = new URLSearchParams(parameters);
  const bundle = await request<Bundle<T>>(options, `${resourceType}?${query}`);
  return (bundle.entry ?? []).map((entry) => entry.resource).filter((resource): resource is T => !!resource);
}

async function read<T extends Resource>(options: Options, resourceType: T['resourceType'], id: string): Promise<T> {
  return request<T>(options, `${resourceType}/${encodeURIComponent(id)}`);
}

async function request<T>(options: Options, path: string): Promise<T> {
  const response = await fetch(new URL(`fhir/R4/${path}`, options.baseUrl), {
    headers: { authorization: `Bearer ${options.accessToken}`, accept: 'application/fhir+json' },
  });
  if (!response.ok) throw new Error(`Medplum state read failed with HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

function referenceId(reference: string | undefined): string | undefined {
  const match = /^Patient\/([^/]+)$/.exec(reference ?? '');
  return match?.[1];
}

function memberIdsFromPolicy(policy: AccessPolicy | undefined): Set<string> {
  const ids = new Set<string>();
  for (const rule of policy?.resource ?? []) {
    const match = rule.criteria?.match(/(?:_id=|subject=Patient\/)([^&]+)/);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function tasksFromPolicy(policy: AccessPolicy | undefined): Set<AgentTask> {
  const tasks = new Set<AgentTask>();
  if (policy?.resource?.some((rule) => rule.resourceType === 'Provenance' && rule.interaction?.includes('create'))) {
    tasks.add('digitize-measurement');
  }
  return tasks;
}
