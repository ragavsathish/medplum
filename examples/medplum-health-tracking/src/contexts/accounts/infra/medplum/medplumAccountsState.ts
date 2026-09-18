// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MedplumClient } from '@medplum/core';
import type { AccessPolicy } from '@medplum/fhirtypes';
import type { AccountsRepository } from '../../application/ports/accountsRepository';
import type { AgentGrant, AgentTask } from '../../domain/account';

type Options = {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly accountIdentifierSystem: string;
  readonly ownerPolicyIdByAccountId: ReadonlyMap<string, string>;
  readonly agentPolicyIdByAgentId: ReadonlyMap<string, string>;
};

/** Reads Accounts state from Medplum resources. save is intentionally a no-op: resource mutations belong to the provisioner. */
export function createMedplumAccountsState(options: Options) {
  const medplum = new MedplumClient({ baseUrl: options.baseUrl, accessToken: options.accessToken });

  return {
    async find(accountId) {
      const selfMembers = await medplum.searchResources('Patient', {
        identifier: `${options.accountIdentifierSystem}|${accountId}`,
        _count: '2',
      });
      if (selfMembers.length !== 1) {
        return undefined;
      }
      const selfMemberId = selfMembers[0].id;
      const related = await medplum.searchResources('RelatedPerson', {
        identifier: `${options.accountIdentifierSystem}|${accountId}`,
      });
      const minorProfileIds = new Set(
        related.map((resource) => referenceId(resource.patient?.reference)).filter((id): id is string => !!id)
      );
      const ownerPolicyId = options.ownerPolicyIdByAccountId.get(accountId);
      const ownerPolicy = ownerPolicyId ? await medplum.readResource('AccessPolicy', ownerPolicyId) : undefined;
      const linkedMemberIds = memberIdsFromPolicy(ownerPolicy);
      linkedMemberIds.delete(selfMemberId);
      const agentGrants = new Map<string, AgentGrant>();
      for (const [agentId, policyId] of options.agentPolicyIdByAgentId) {
        const policy = await medplum.readResource('AccessPolicy', policyId);
        const memberIds = memberIdsFromPolicy(policy);
        if (memberIds.size) agentGrants.set(agentId, { memberIds, tasks: tasksFromPolicy(policy) });
      }
      return { accountId, selfMemberId, minorProfileIds, linkedMemberIds, agentGrants };
    },
    async save() {
      // Medplum resources are the source of truth. The provisioner performs writes before this point.
    },
  } satisfies AccountsRepository;
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
