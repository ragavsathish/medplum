// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Express, Response } from 'express';
import express from 'express';
import type { AccountIdentityProvider } from '../../application/ports/accountIdentityProvider';
import type {
  AccountsProvisioner,
  AgentGrantCommand,
  CreateMinorProfileCommand,
} from '../../application/ports/accountsProvisioner';
import type { AccountsRepository } from '../../application/ports/accountsRepository';
import type { AgentTask } from '../../domain/account';
import {
  activateFamilyLink,
  endFamilyLink,
  onboardAccount,
  registerMinorProfile,
  replaceAgentGrant,
  revokeAgentMemberAccess,
} from '../../domain/account';
import { createMedplumAccountIdentityProvider } from '../medplum/medplumAccountIdentityProvider';
import { createInMemoryAccountsRepository } from '../memory/inMemoryAccountsRepository';
import { ACCOUNTS_OPENAPI } from './accountsOpenApi';

export type { AccountsProvisioner } from '../../application/ports/accountsProvisioner';

type AccountsHttpAppOptions = {
  readonly medplumBaseUrl: string;
  readonly provisioner?: AccountsProvisioner;
  readonly accountsRepository?: AccountsRepository;
  readonly identityProvider?: AccountIdentityProvider;
};

export function createAccountsHttpApp(options: AccountsHttpAppOptions): Express {
  const app = express();
  const accountsRepository = options.accountsRepository ?? createInMemoryAccountsRepository();
  const identityProvider = options.identityProvider ?? createMedplumAccountIdentityProvider(options.medplumBaseUrl);

  app.use(express.json());

  app.get('/accounts/openapi.json', (_request, response) => response.status(200).json(ACCOUNTS_OPENAPI));

  app.post('/accounts/onboard', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId, selfMember } = authentication.identity;

    const existingAccount = await accountsRepository.find(accountId);
    const account = onboardAccount(existingAccount, accountId, selfMember.id);
    await accountsRepository.save(account);

    response.status(200).json({
      type: 'ACCOUNT_ONBOARDED',
      payload: {
        accountId,
        selfMember,
        selectableMembers: [selfMember],
      },
    });
  });

  app.post('/accounts/minor-profiles', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId } = authentication.identity;
    const account = await accountsRepository.find(accountId);
    if (!account) {
      response.status(409).json({ code: 'ACCOUNT_NOT_ONBOARDED' });
      return;
    }

    const input = request.body as Partial<CreateMinorProfileCommand['member']> & {
      relationship?: CreateMinorProfileCommand['relationship'];
    };
    if (
      !input.id ||
      !input.identifier?.system ||
      !input.identifier.value ||
      !input.name?.given?.length ||
      !input.name.family ||
      !input.birthDate ||
      (input.relationship !== 'parent' && input.relationship !== 'guardian')
    ) {
      response.status(400).json({ code: 'INVALID_MINOR_PROFILE' });
      return;
    }

    if (!options.provisioner) {
      response.status(503).json({ code: 'PROVISIONER_UNAVAILABLE' });
      return;
    }

    const command: CreateMinorProfileCommand = {
      accountId,
      member: {
        id: input.id,
        identifier: input.identifier,
        name: input.name,
        birthDate: input.birthDate,
      },
      relationship: input.relationship,
    };
    const result = await options.provisioner.createMinorProfile(command);
    if (!result.ok) {
      if (result.reason === 'IDENTIFIER_COLLISION') {
        response.status(409).json({
          type: 'MINOR_PROFILE_CREATION_REJECTED',
          payload: { reason: 'IDENTIFIER_COLLISION' },
        });
        return;
      }
      response.status(409).json({ code: 'MINOR_PROFILE_CREATION_FAILED' });
      return;
    }

    const memberId = result.memberId ?? command.member.id;
    await accountsRepository.save(registerMinorProfile(account, memberId));

    response.status(201).json({
      type: 'MINOR_PROFILE_CREATED',
      payload: {
        member: { resourceType: 'Patient', id: memberId },
        relationship: command.relationship,
      },
    });
  });

  app.post('/accounts/family-links', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId } = authentication.identity;
    const account = await accountsRepository.find(accountId);
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    if (!account || !memberId || !account.minorProfileIds.has(memberId)) {
      response.status(409).json({ code: 'MINOR_PROFILE_NOT_AVAILABLE' });
      return;
    }

    if (!options.provisioner?.activateOwnerAccess) {
      response.status(503).json({ code: 'PROVISIONER_UNAVAILABLE' });
      return;
    }
    const result = await options.provisioner.activateOwnerAccess({ accountId, memberId });
    if (!result.ok) {
      response.status(503).json({ type: 'FAMILY_LINK_FAILED', payload: { reason: result.reason } });
      return;
    }

    const linkedAccount = activateFamilyLink(account, memberId);
    await accountsRepository.save(linkedAccount);
    response.status(201).json({
      type: 'FAMILY_LINK_ACTIVATED',
      payload: {
        member: { resourceType: 'Patient', id: memberId },
        selectableMembers: [linkedAccount.selfMemberId, ...linkedAccount.linkedMemberIds].map((id) => ({
          resourceType: 'Patient',
          id,
        })),
      },
    });
  });

  app.post('/accounts/agent-grants', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId } = authentication.identity;
    const account = await accountsRepository.find(accountId);
    const agentId = typeof request.body?.agentId === 'string' ? request.body.agentId : undefined;
    const memberIds = Array.isArray(request.body?.memberIds)
      ? request.body.memberIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const requestedTasks = Array.isArray(request.body?.tasks)
      ? request.body.tasks.filter((task: unknown): task is string => typeof task === 'string')
      : [];
    const tasks = requestedTasks as AgentTask[];
    const permittedMemberIds = account ? new Set([account.selfMemberId, ...account.linkedMemberIds]) : new Set();

    if (
      !account ||
      !agentId ||
      memberIds.length === 0 ||
      tasks.length === 0 ||
      requestedTasks.length !== request.body?.tasks?.length ||
      requestedTasks.some((task: string) => task !== 'digitize-measurement') ||
      memberIds.some((id: string) => !permittedMemberIds.has(id))
    ) {
      response.status(400).json({ code: 'INVALID_AGENT_GRANT' });
      return;
    }
    if (!options.provisioner?.activateAgentAccess) {
      response.status(503).json({ code: 'PROVISIONER_UNAVAILABLE' });
      return;
    }

    const command: AgentGrantCommand = {
      grantorAccountId: accountId,
      agentId,
      memberIds,
      previousMemberIds: [...(account.agentGrants.get(agentId)?.memberIds ?? [])],
      tasks,
    };
    const result = await options.provisioner.activateAgentAccess(command);
    if (!result.ok) {
      response.status(503).json({ code: 'AGENT_GRANT_FAILED' });
      return;
    }

    await accountsRepository.save(replaceAgentGrant(account, agentId, memberIds, tasks));
    response.status(201).json({
      type: 'AGENT_ACCESS_GRANTED',
      payload: { grantorAccountId: accountId, agentId, memberIds, tasks },
    });
  });

  app.post('/accounts/agent-grants/revoke-member', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId } = authentication.identity;
    const account = await accountsRepository.find(accountId);
    const agentId = typeof request.body?.agentId === 'string' ? request.body.agentId : undefined;
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    const grant = agentId ? account?.agentGrants.get(agentId) : undefined;
    if (!account || !agentId || !memberId || !grant?.memberIds.has(memberId)) {
      response.status(409).json({ code: 'AGENT_MEMBER_ACCESS_NOT_ACTIVE' });
      return;
    }
    if (!options.provisioner?.deactivateAgentAccess) {
      response.status(503).json({ code: 'PROVISIONER_UNAVAILABLE' });
      return;
    }

    const result = await options.provisioner.deactivateAgentAccess({
      grantorAccountId: accountId,
      agentId,
      memberId,
    });
    if (!result.ok) {
      response.status(503).json({ code: 'AGENT_REVOCATION_FAILED' });
      return;
    }

    const revokedAccount = revokeAgentMemberAccess(account, agentId, memberId);
    await accountsRepository.save(revokedAccount);
    response.status(200).json({
      type: 'AGENT_MEMBER_ACCESS_REVOKED',
      payload: {
        agentId,
        revokedMemberId: memberId,
        remainingMemberIds: [...(revokedAccount.agentGrants.get(agentId)?.memberIds ?? [])],
      },
    });
  });

  app.post('/accounts/family-links/unlink', async (request, response) => {
    const authentication = await identityProvider.authenticate(request.get('authorization'));
    if (!authentication.ok) {
      sendAuthenticationFailure(response, authentication.reason);
      return;
    }
    const { accountId } = authentication.identity;
    const account = await accountsRepository.find(accountId);
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    if (!account || !memberId || !account.linkedMemberIds.has(memberId)) {
      response.status(409).json({ code: 'FAMILY_LINK_NOT_ACTIVE' });
      return;
    }
    if (!options.provisioner?.deactivateFamilyAccess) {
      response.status(503).json({ code: 'PROVISIONER_UNAVAILABLE' });
      return;
    }

    const derivativeAgentIds = [...account.agentGrants]
      .filter(([, grant]) => grant.memberIds.has(memberId))
      .map(([agentId]) => agentId);
    const result = await options.provisioner.deactivateFamilyAccess({
      accountId,
      memberId,
      derivativeAgentIds,
    });
    if (!result.ok) {
      response.status(503).json({ type: 'FAMILY_UNLINK_FAILED', payload: { reason: result.reason } });
      return;
    }

    const unlinkedAccount = endFamilyLink(account, memberId);
    await accountsRepository.save(unlinkedAccount);
    response.status(200).json({
      type: 'FAMILY_LINK_ENDED',
      payload: {
        memberId,
        selectableMembers: [unlinkedAccount.selfMemberId, ...unlinkedAccount.linkedMemberIds].map((id) => ({
          resourceType: 'Patient',
          id,
        })),
      },
    });
  });

  return app;
}

function sendAuthenticationFailure(
  response: Response,
  reason: 'AUTHENTICATION_REQUIRED' | 'SELF_MEMBER_UNAVAILABLE'
): void {
  response.status(reason === 'AUTHENTICATION_REQUIRED' ? 401 : 409).json({ code: reason });
}
