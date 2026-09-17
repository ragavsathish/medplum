// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Express } from 'express';
import express from 'express';
import { createAccountsCommandHandler } from '../../application/accountsCommandHandler';
import {
  createMinorProfileRequestSchema,
  familyMemberRequestSchema,
  grantAgentAccessRequestSchema,
  revokeAgentMemberAccessRequestSchema,
} from '../../application/contracts/accountsApi';
import type { AccountIdentityProvider } from '../../application/ports/accountIdentityProvider';
import type { AccountsProvisioner } from '../../application/ports/accountsProvisioner';
import type { AccountsRepository } from '../../application/ports/accountsRepository';
import { createMedplumAccountIdentityProvider } from '../medplum/medplumAccountIdentityProvider';
import { ACCOUNTS_OPENAPI } from './accountsOpenApi';
import {
  createAccountsAuthenticationMiddleware,
  getAccountRequestContext,
  getAuthenticatedAccountIdentity,
} from './authenticationMiddleware';

export type { AccountsProvisioner } from '../../application/ports/accountsProvisioner';

type AccountsHttpAppOptions = {
  readonly medplumBaseUrl: string;
  readonly provisioner?: AccountsProvisioner;
  readonly accountsRepository: AccountsRepository;
  readonly identityProvider?: AccountIdentityProvider;
};

export function createAccountsHttpApp(options: AccountsHttpAppOptions): Express {
  const app = express();
  const identityProvider = options.identityProvider ?? createMedplumAccountIdentityProvider(options.medplumBaseUrl);
  const commandHandler = createAccountsCommandHandler({
    accountsRepository: options.accountsRepository,
    provisioner: options.provisioner,
  });

  app.use(express.json());
  app.get('/accounts/openapi.json', (_request, response) => response.status(200).json(ACCOUNTS_OPENAPI));
  app.use('/accounts', createAccountsAuthenticationMiddleware(identityProvider));

  app.post('/accounts/onboard', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    response.status(200).json(await commandHandler.onboard(identity));
  });

  app.post('/accounts/minor-profiles', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    const parsed = createMinorProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_MINOR_PROFILE' });
      return;
    }
    const result = await commandHandler.createMinorProfile(identity, parsed.data, getAccountRequestContext(request));
    if (result.ok) {
      response.status(201).json(result.event);
      return;
    }
    if (result.reason === 'IDENTIFIER_COLLISION') {
      response.status(409).json({ type: 'MINOR_PROFILE_CREATION_REJECTED', payload: { reason: result.reason } });
      return;
    }
    response.status(result.reason === 'PROVISIONER_UNAVAILABLE' ? 503 : 409).json({
      code: result.reason === 'UNAVAILABLE' ? 'MINOR_PROFILE_CREATION_FAILED' : result.reason,
    });
  });

  app.post('/accounts/family-links', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    const parsed = familyMemberRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_FAMILY_LINK' });
      return;
    }
    const result = await commandHandler.activateFamilyLink(identity, parsed.data, getAccountRequestContext(request));
    if (result.ok) {
      response.status(201).json(result.event);
      return;
    }
    if (result.reason === 'FAMILY_LINK_FAILED') {
      response.status(503).json({ type: result.reason, payload: { reason: result.detail } });
      return;
    }
    response.status(result.reason === 'PROVISIONER_UNAVAILABLE' ? 503 : 409).json({ code: result.reason });
  });

  app.post('/accounts/agent-grants', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    const parsed = grantAgentAccessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_AGENT_GRANT' });
      return;
    }
    const result = await commandHandler.grantAgentAccess(identity, parsed.data, getAccountRequestContext(request));
    if (result.ok) {
      response.status(201).json(result.event);
      return;
    }
    response
      .status(result.reason === 'PROVISIONER_UNAVAILABLE' || result.reason === 'AGENT_GRANT_FAILED' ? 503 : 400)
      .json({
        code: result.reason,
      });
  });

  app.post('/accounts/agent-grants/revoke-member', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    const parsed = revokeAgentMemberAccessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_AGENT_REVOCATION' });
      return;
    }
    const result = await commandHandler.revokeAgentMemberAccess(
      identity,
      parsed.data,
      getAccountRequestContext(request)
    );
    if (result.ok) {
      response.status(200).json(result.event);
      return;
    }
    response
      .status(result.reason === 'PROVISIONER_UNAVAILABLE' || result.reason === 'AGENT_REVOCATION_FAILED' ? 503 : 409)
      .json({
        code: result.reason,
      });
  });

  app.post('/accounts/family-links/unlink', async (request, response) => {
    const identity = getAuthenticatedAccountIdentity(response);
    const parsed = familyMemberRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: 'INVALID_FAMILY_UNLINK' });
      return;
    }
    const result = await commandHandler.endFamilyLink(identity, parsed.data, getAccountRequestContext(request));
    if (result.ok) {
      response.status(200).json(result.event);
      return;
    }
    if (result.reason === 'FAMILY_UNLINK_FAILED') {
      response.status(503).json({ type: result.reason, payload: { reason: result.detail } });
      return;
    }
    response.status(result.reason === 'PROVISIONER_UNAVAILABLE' ? 503 : 409).json({ code: result.reason });
  });

  return app;
}
