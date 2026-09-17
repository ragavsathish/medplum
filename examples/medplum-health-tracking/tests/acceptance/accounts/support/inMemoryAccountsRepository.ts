// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccountsRepository } from '../../../src/contexts/accounts/application/ports/accountsRepository';
import type { Account, AgentGrant } from '../../../src/contexts/accounts/domain/account';

export function createInMemoryAccountsRepository(): AccountsRepository {
  const accounts = new Map<string, Account>();

  return {
    async find(accountId) {
      const account = accounts.get(accountId);
      return account ? cloneAccount(account) : undefined;
    },
    async save(account) {
      accounts.set(account.accountId, cloneAccount(account));
    },
  };
}

function cloneAccount(account: Account): Account {
  return {
    ...account,
    minorProfileIds: new Set(account.minorProfileIds),
    linkedMemberIds: new Set(account.linkedMemberIds),
    agentGrants: new Map(
      [...account.agentGrants].map(([agentId, grant]): [string, AgentGrant] => [
        agentId,
        { memberIds: new Set(grant.memberIds), tasks: new Set(grant.tasks) },
      ])
    ),
  };
}
