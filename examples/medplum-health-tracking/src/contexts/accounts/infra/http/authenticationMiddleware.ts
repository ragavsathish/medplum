// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { NextFunction, Request, Response } from 'express';
import type {
  AccountAuthenticationResult,
  AccountIdentity,
  AccountIdentityProvider,
} from '../../application/ports/accountIdentityProvider';

export function createAccountsAuthenticationMiddleware(identityProvider: AccountIdentityProvider) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const authentication = await identityProvider.authenticate(
      request.get('authorization'),
      getAccountRequestContext(request)
    );
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    response.locals.accountIdentity = authentication.identity;
    next();
  };
}

export function getAuthenticatedAccountIdentity(response: Response): AccountIdentity {
  return response.locals.accountIdentity as AccountIdentity;
}

export function getAccountRequestContext(request: Request): { readonly correlationTraceId?: string } {
  const traceParent = request.get('traceparent');
  const traceId = traceParent?.match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-(?:0[01])$/i)?.[1];
  if (traceId && !/^0{32}$/.test(traceId)) {
    return { correlationTraceId: traceId.toLowerCase() };
  }
  const correlationId = request.get('x-correlation-id')?.replaceAll('-', '');
  return correlationId && /^[0-9a-f]{32}$/i.test(correlationId) && !/^0{32}$/.test(correlationId)
    ? { correlationTraceId: correlationId.toLowerCase() }
    : {};
}

function sendAuthenticationFailure(
  response: Response,
  reason: Extract<AccountAuthenticationResult, { readonly ok: false }>['reason']
): void {
  response.status(reason === 'AUTHENTICATION_REQUIRED' ? 401 : 409).json({ code: reason });
}
