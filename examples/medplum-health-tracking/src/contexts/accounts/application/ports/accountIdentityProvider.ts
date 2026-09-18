// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { PatientReference } from '../contracts/accountsApi';
import type { AccountRequestContext } from './accountRequestContext';

export type AccountIdentity = {
  readonly accountId: string;
  readonly selfMember: Readonly<PatientReference>;
};

export type AccountAuthenticationResult =
  | { readonly ok: true; readonly identity: AccountIdentity }
  | { readonly ok: false; readonly reason: 'AUTHENTICATION_REQUIRED' | 'SELF_MEMBER_UNAVAILABLE' };

export type AccountIdentityProvider = {
  authenticate(
    authorization: string | undefined,
    context?: AccountRequestContext
  ): Promise<AccountAuthenticationResult>;
};
