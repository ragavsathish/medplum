// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import type { AccountIdentityProvider } from '../../application/ports/accountIdentityProvider';

const BEARER_TOKEN = /^Bearer\s+\S+$/i;

type AccountSession = {
  readonly user?: { readonly id?: string };
  readonly profile?: { readonly resourceType?: string; readonly id?: string };
};

export function createMedplumAccountIdentityProvider(medplumBaseUrl: string): AccountIdentityProvider {
  return {
    async authenticate(authorization, context) {
      if (!authorization?.match(BEARER_TOKEN)) {
        return { ok: false, reason: 'AUTHENTICATION_REQUIRED' };
      }
      const response = await fetch(new URL('auth/me', medplumBaseUrl), {
        headers: { authorization, ...correlationHeaders(context?.correlationTraceId) },
      });
      if (!response.ok) {
        return { ok: false, reason: 'AUTHENTICATION_REQUIRED' };
      }
      const session = (await response.json()) as AccountSession;
      if (!session.user?.id || session.profile?.resourceType !== 'Patient' || !session.profile.id) {
        return { ok: false, reason: 'SELF_MEMBER_UNAVAILABLE' };
      }
      return {
        ok: true,
        identity: {
          accountId: session.user.id,
          selfMember: { resourceType: 'Patient', id: session.profile.id },
        },
      };
    },
  };
}

function correlationHeaders(traceId: string | undefined): Record<string, string> {
  return traceId ? { traceparent: `00-${traceId}-${randomUUID().replaceAll('-', '').slice(0, 16)}-01` } : {};
}
