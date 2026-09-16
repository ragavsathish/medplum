// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Express } from 'express';
import express from 'express';
import { ACCOUNTS_OPENAPI } from './accountsOpenApi';

const BEARER_TOKEN = /^Bearer\s+(\S+)$/i;

type AccountsHttpAppOptions = {
  readonly medplumBaseUrl: string;
  readonly provisioner?: AccountsProvisioner;
};

export type AccountsProvisioner = {
  createMinorProfile(
    command: CreateMinorProfileCommand
  ): Promise<
    | { readonly ok: true; readonly memberId?: string }
    | { readonly ok: false; readonly reason: 'IDENTIFIER_COLLISION' | 'UNAVAILABLE' }
  >;
  activateOwnerAccess?(
    command: MemberAccessCommand
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' }>;
  activateAgentAccess?(
    command: AgentGrantCommand
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' }>;
  deactivateAgentAccess?(
    command: AgentMemberAccessCommand
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' }>;
  deactivateFamilyAccess?(
    command: FamilyAccessCommand
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' }>;
};

type MemberAccessCommand = {
  readonly accountId: string;
  readonly memberId: string;
};

type AgentGrantCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberIds: string[];
  readonly tasks: string[];
};

type AgentMemberAccessCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberId: string;
};

type FamilyAccessCommand = {
  readonly accountId: string;
  readonly memberId: string;
  readonly derivativeAgentIds: string[];
};

type CreateMinorProfileCommand = {
  readonly accountId: string;
  readonly member: {
    readonly id: string;
    readonly identifier: { readonly system: string; readonly value: string };
    readonly name: { readonly given: string[]; readonly family: string };
    readonly birthDate: string;
  };
  readonly relationship: 'parent' | 'guardian';
};

type AccountSession = {
  readonly user?: { readonly resourceType?: string; readonly id?: string };
  readonly profile?: { readonly resourceType?: string; readonly id?: string };
};

export function createAccountsHttpApp(options: AccountsHttpAppOptions): Express {
  const app = express();
  const accounts = new Map<
    string,
    {
      readonly selfMemberId: string;
      readonly minorProfileIds: Set<string>;
      readonly linkedMemberIds: Set<string>;
      readonly agentGrants: Map<string, { readonly memberIds: Set<string>; readonly tasks: Set<string> }>;
    }
  >();

  app.use(express.json());

  app.get('/accounts/openapi.json', (_request, response) => response.status(200).json(ACCOUNTS_OPENAPI));

  app.post('/accounts/onboard', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (sessionResponse.status === 401) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const selfMember = session.profile;

    if (!accountId || selfMember?.resourceType !== 'Patient' || !selfMember.id) {
      response.status(409).json({ code: 'SELF_MEMBER_UNAVAILABLE' });
      return;
    }

    response.status(200).json({
      type: 'ACCOUNT_ONBOARDED',
      payload: {
        accountId,
        selfMember,
        selectableMembers: [selfMember],
      },
    });
    accounts.set(accountId, {
      selfMemberId: selfMember.id,
      minorProfileIds: new Set(),
      linkedMemberIds: new Set(),
      agentGrants: new Map(),
    });
  });

  app.post('/accounts/minor-profiles', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const account = accountId ? accounts.get(accountId) : undefined;
    if (!accountId || !account) {
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
    account.minorProfileIds.add(memberId);

    response.status(201).json({
      type: 'MINOR_PROFILE_CREATED',
      payload: {
        member: { resourceType: 'Patient', id: memberId },
        relationship: command.relationship,
      },
    });
  });

  app.post('/accounts/family-links', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const account = accountId ? accounts.get(accountId) : undefined;
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    if (!accountId || !account || !memberId || !account.minorProfileIds.has(memberId)) {
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

    account.linkedMemberIds.add(memberId);
    response.status(201).json({
      type: 'FAMILY_LINK_ACTIVATED',
      payload: {
        member: { resourceType: 'Patient', id: memberId },
        selectableMembers: [account.selfMemberId, ...account.linkedMemberIds].map((id) => ({
          resourceType: 'Patient',
          id,
        })),
      },
    });
  });

  app.post('/accounts/agent-grants', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const account = accountId ? accounts.get(accountId) : undefined;
    const agentId = typeof request.body?.agentId === 'string' ? request.body.agentId : undefined;
    const memberIds = Array.isArray(request.body?.memberIds)
      ? request.body.memberIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const tasks = Array.isArray(request.body?.tasks)
      ? request.body.tasks.filter((task: unknown): task is string => typeof task === 'string')
      : [];
    const permittedMemberIds = account ? new Set([account.selfMemberId, ...account.linkedMemberIds]) : new Set();

    if (
      !accountId ||
      !account ||
      !agentId ||
      memberIds.length === 0 ||
      tasks.length === 0 ||
      tasks.some((task: string) => task !== 'digitize-measurement') ||
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
      tasks,
    };
    const result = await options.provisioner.activateAgentAccess(command);
    if (!result.ok) {
      response.status(503).json({ code: 'AGENT_GRANT_FAILED' });
      return;
    }

    account.agentGrants.set(agentId, { memberIds: new Set(memberIds), tasks: new Set(tasks) });
    response.status(201).json({ type: 'AGENT_ACCESS_GRANTED', payload: command });
  });

  app.post('/accounts/agent-grants/revoke-member', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const account = accountId ? accounts.get(accountId) : undefined;
    const agentId = typeof request.body?.agentId === 'string' ? request.body.agentId : undefined;
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    const grant = agentId ? account?.agentGrants.get(agentId) : undefined;
    if (!accountId || !account || !agentId || !memberId || !grant?.memberIds.has(memberId)) {
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

    grant.memberIds.delete(memberId);
    response.status(200).json({
      type: 'AGENT_MEMBER_ACCESS_REVOKED',
      payload: {
        agentId,
        revokedMemberId: memberId,
        remainingMemberIds: [...grant.memberIds],
      },
    });
  });

  app.post('/accounts/family-links/unlink', async (request, response) => {
    const accessToken = request.get('authorization')?.match(BEARER_TOKEN)?.[1];
    if (!accessToken) {
      response.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const sessionResponse = await fetch(new URL('auth/me', options.medplumBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const session = (await sessionResponse.json()) as AccountSession;
    const accountId = session.user?.id;
    const account = accountId ? accounts.get(accountId) : undefined;
    const memberId = typeof request.body?.memberId === 'string' ? request.body.memberId : undefined;
    if (!accountId || !account || !memberId || !account.linkedMemberIds.has(memberId)) {
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

    account.linkedMemberIds.delete(memberId);
    for (const grant of account.agentGrants.values()) {
      grant.memberIds.delete(memberId);
    }
    response.status(200).json({
      type: 'FAMILY_LINK_ENDED',
      payload: {
        memberId,
        selectableMembers: [account.selfMemberId, ...account.linkedMemberIds].map((id) => ({
          resourceType: 'Patient',
          id,
        })),
      },
    });
  });

  return app;
}
