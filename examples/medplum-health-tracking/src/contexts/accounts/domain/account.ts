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
  return {
    ...account,
    agentGrants: new Map([
      ...[...account.agentGrants].filter(([existingAgentId]) => existingAgentId !== agentId),
      [agentId, { memberIds: new Set(memberIds), tasks: new Set(tasks) }] as const,
    ]),
  };
}

export function revokeAgentMemberAccess(account: Account, agentId: string, memberId: string): Account {
  const grant = account.agentGrants.get(agentId);
  if (!grant) {
    return account;
  }
  return {
    ...account,
    agentGrants: new Map([
      ...[...account.agentGrants].filter(([existingAgentId]) => existingAgentId !== agentId),
      [
        agentId,
        { ...grant, memberIds: new Set([...grant.memberIds].filter((candidate) => candidate !== memberId)) },
      ] as const,
    ]),
  };
}

export function endFamilyLink(account: Account, memberId: string): Account {
  return {
    ...account,
    linkedMemberIds: new Set([...account.linkedMemberIds].filter((candidate) => candidate !== memberId)),
    agentGrants: new Map(
      [...account.agentGrants].map(([agentId, grant]) => [
        agentId,
        { ...grant, memberIds: new Set([...grant.memberIds].filter((candidate) => candidate !== memberId)) },
      ])
    ),
  };
}
