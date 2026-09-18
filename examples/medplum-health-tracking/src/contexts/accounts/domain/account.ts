// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export const AGENT_TASKS = ['digitize-measurement'] as const;
export type AgentTask = (typeof AGENT_TASKS)[number];

export const FAMILY_RELATIONSHIPS = ['parent', 'guardian'] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

export type AgentGrant = {
  readonly memberIds: ReadonlySet<string>;
  readonly tasks: ReadonlySet<AgentTask>;
};

export type Account = {
  readonly accountId: string;
  readonly selfMemberId: string;
  readonly minorProfileIds: ReadonlySet<string>;
  readonly linkedMemberIds: ReadonlySet<string>;
  readonly agentGrants: ReadonlyMap<string, AgentGrant>;
};

export function onboardAccount(existing: Account | undefined, accountId: string, selfMemberId: string): Account {
  return (
    existing ?? {
      accountId,
      selfMemberId,
      minorProfileIds: new Set(),
      linkedMemberIds: new Set(),
      agentGrants: new Map(),
    }
  );
}

export function registerMinorProfile(account: Account, memberId: string): Account {
  return { ...account, minorProfileIds: new Set([...account.minorProfileIds, memberId]) };
}

export function activateFamilyLink(account: Account, memberId: string): Account {
  return { ...account, linkedMemberIds: new Set([...account.linkedMemberIds, memberId]) };
}

export function replaceAgentGrant(
  account: Account,
  agentId: string,
  memberIds: readonly string[],
  tasks: readonly AgentTask[]
): Account {
  const agentGrants = new Map(account.agentGrants);
  agentGrants.set(agentId, { memberIds: new Set(memberIds), tasks: new Set(tasks) });
  return {
    ...account,
    agentGrants,
  };
}

export function revokeAgentMemberAccess(account: Account, agentId: string, memberId: string): Account {
  const grant = account.agentGrants.get(agentId);
  if (!grant) {
    return account;
  }
  const agentGrants = new Map(account.agentGrants);
  agentGrants.set(agentId, {
    ...grant,
    memberIds: new Set([...grant.memberIds].filter((candidate) => candidate !== memberId)),
  });
  return {
    ...account,
    agentGrants,
  };
}

export function endFamilyLink(account: Account, memberId: string): Account {
  const agentGrants = new Map(account.agentGrants);
  for (const [agentId, grant] of agentGrants) {
    agentGrants.set(agentId, {
      ...grant,
      memberIds: new Set([...grant.memberIds].filter((candidate) => candidate !== memberId)),
    });
  }
  return {
    ...account,
    linkedMemberIds: new Set([...account.linkedMemberIds].filter((candidate) => candidate !== memberId)),
    agentGrants,
  };
}
