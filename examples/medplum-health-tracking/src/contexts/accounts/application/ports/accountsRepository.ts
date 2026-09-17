// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { Account } from '../../domain/account';

export type AccountsRepository = {
  find(accountId: string): Promise<Account | undefined>;
  save(account: Account): Promise<void>;
};
