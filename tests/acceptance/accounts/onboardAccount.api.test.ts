// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { AccountsProvisioner } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/http/accountsHttpApp';
import { createAccountsHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/http/accountsHttpApp';
import { createInMemoryAccountsRepository } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/memory/inMemoryAccountsRepository';

const medplumBaseUrl = 'http://medplum.test/';
const openServers: Server[] = [];
const medplum = setupServer();

beforeAll(() =>
  medplum.listen({
    onUnhandledRequest(request, print) {
      if (new URL(request.url).hostname === '127.0.0.1') {
        return;
      }
      print.error();
    },
  })
);
afterEach(async () => {
  medplum.resetHandlers();
  await Promise.all(openServers.splice(0).map(closeServer));
});
afterAll(() => medplum.close());

describe('Accounts HTTP API — onboarding', () => {
  test('publishes the Accounts command contract', async () => {
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl })));
    const response = await fetch(`${appServer.url}accounts/openapi.json`);
    const body = (await response.json()) as {
      paths?: Record<string, any>;
      components?: { schemas?: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(Object.keys(body.paths ?? {})).toEqual([
      '/accounts/onboard',
      '/accounts/minor-profiles',
      '/accounts/family-links',
      '/accounts/agent-grants',
      '/accounts/agent-grants/revoke-member',
      '/accounts/family-links/unlink',
    ]);
    expect(Object.keys(body.components?.schemas ?? {})).toEqual([
      'PatientReference',
      'Error',
      'OnboardAccountEvent',
      'CreateMinorProfileCommand',
      'MinorProfileCreatedEvent',
      'ActivateFamilyLinkCommand',
      'FamilyLinkActivatedEvent',
      'AgentTask',
      'GrantAgentAccessCommand',
      'AgentAccessGrantedEvent',
      'RevokeAgentMemberAccessCommand',
      'AgentMemberAccessRevokedEvent',
      'UnlinkFamilyMemberCommand',
      'FamilyLinkEndedEvent',
    ]);
    expect(body.paths?.['/accounts/agent-grants']?.post?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/GrantAgentAccessCommand',
    });
    expect(
      body.paths?.['/accounts/agent-grants']?.post?.responses?.['201']?.content?.['application/json']?.schema
    ).toEqual({ $ref: '#/components/schemas/AgentAccessGrantedEvent' });
    expect(body.components?.schemas?.['AgentTask']).toEqual({
      type: 'string',
      enum: ['digitize-measurement'],
    });
    expect(body.components?.schemas?.['CreateMinorProfileCommand']).toMatchObject({
      additionalProperties: false,
      required: ['id', 'identifier', 'name', 'birthDate', 'relationship'],
      properties: {
        birthDate: { type: 'string', format: 'date' },
        relationship: { type: 'string', enum: ['parent', 'guardian'] },
      },
    });
  });

  test('identifies one account and selectable self-member profile for the authenticated identity', async () => {
    await traceTo('DI-ACC-001', 'AC-ACC-001', 'AC-ACC-002');
    medplum.use(
      http.get(`${medplumBaseUrl}auth/me`, () =>
        HttpResponse.json({
          user: { resourceType: 'User', id: 'alice-user' },
          membership: {
            resourceType: 'ProjectMembership',
            id: 'alice-membership',
            profile: { reference: 'Patient/alice' },
          },
          profile: { resourceType: 'Patient', id: 'alice' },
        })
      )
    );

    const result = await postOnboardAccount();

    expect(result).toEqual({
      status: 200,
      body: {
        type: 'ACCOUNT_ONBOARDED',
        payload: {
          accountId: 'alice-user',
          selfMember: { resourceType: 'Patient', id: 'alice' },
          selectableMembers: [{ resourceType: 'Patient', id: 'alice' }],
        },
      },
    });
  });

  test('returns an authentication failure when the authenticated session is rejected', async () => {
    await traceTo('DI-ACC-001');
    medplum.use(
      http.get(`${medplumBaseUrl}auth/me`, () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
      )
    );

    const result = await postOnboardAccount();

    expect(result).toEqual({ status: 401, body: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  test('applies the same authentication failure to every Accounts command', async () => {
    medplum.use(
      http.get(`${medplumBaseUrl}auth/me`, () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
      )
    );
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));

    const result = await postJson(`${appServer.url}accounts/minor-profiles`, {});

    expect(result).toEqual({ status: 401, body: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  test('creates a minor profile from a stated guardian relationship without a minor login', async () => {
    await traceTo('DI-ACC-002', 'AC-ACC-003');
    useAliceSession();
    const provisioned: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile(command) {
        provisioned.push(command);
        return { ok: true };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
    await postJson(`${appServer.url}accounts/onboard`, undefined);

    const result = await postJson(`${appServer.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'guardian',
    });

    expect(result).toEqual({
      status: 201,
      body: {
        type: 'MINOR_PROFILE_CREATED',
        payload: {
          member: { resourceType: 'Patient', id: '20000000-0000-4000-8000-000000000002' },
          relationship: 'guardian',
        },
      },
    });
    expect(provisioned).toEqual([
      {
        accountId: 'alice-user',
        member: {
          id: '20000000-0000-4000-8000-000000000002',
          identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
          name: { given: ['Charlie'], family: 'Example' },
          birthDate: '2018-03-04',
        },
        relationship: 'guardian',
      },
    ]);
  });

  test('rejects an identifier collision without disclosing or linking the existing Patient', async () => {
    await traceTo('DI-ACC-004', 'AC-ACC-005');
    useAliceSession();
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: false, reason: 'IDENTIFIER_COLLISION' };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
    await postJson(`${appServer.url}accounts/onboard`, undefined);

    const result = await postJson(`${appServer.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'https://family.example/member-id', value: 'existing-charlie' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });

    expect(result).toEqual({
      status: 409,
      body: {
        type: 'MINOR_PROFILE_CREATION_REJECTED',
        payload: { reason: 'IDENTIFIER_COLLISION' },
      },
    });
  });

  test('rejects a minor-profile body that does not satisfy the published schema', async () => {
    useAliceSession();
    let provisioned = false;
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        provisioned = true;
        return { ok: true };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
    await postJson(`${appServer.url}accounts/onboard`, undefined);

    const result = await postJson(`${appServer.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'not-a-uri', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });

    expect(result).toEqual({ status: 400, body: { code: 'INVALID_MINOR_PROFILE' } });
    expect(provisioned).toBe(false);
  });

  test('links and exposes a minor profile only after owner access is confirmed active', async () => {
    await traceTo('DI-ACC-003', 'AC-ACC-004');
    useAliceSession();
    const accessRequests: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess(command) {
        accessRequests.push(command);
        return { ok: true };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
    await postJson(`${appServer.url}accounts/onboard`, undefined);
    await postJson(`${appServer.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });

    const result = await postJson(`${appServer.url}accounts/family-links`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(result).toEqual({
      status: 201,
      body: {
        type: 'FAMILY_LINK_ACTIVATED',
        payload: {
          member: { resourceType: 'Patient', id: '20000000-0000-4000-8000-000000000002' },
          selectableMembers: [
            { resourceType: 'Patient', id: 'alice' },
            { resourceType: 'Patient', id: '20000000-0000-4000-8000-000000000002' },
          ],
        },
      },
    });
    expect(accessRequests).toEqual([{ accountId: 'alice-user', memberId: '20000000-0000-4000-8000-000000000002' }]);
  });

  test('reports a failed family link when owner access cannot be activated', async () => {
    await traceTo('DI-ACC-003', 'AC-ACC-006');
    useAliceSession();
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: false, reason: 'UNAVAILABLE' };
      },
    };
    const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
    await postJson(`${appServer.url}accounts/onboard`, undefined);
    await postJson(`${appServer.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });

    const result = await postJson(`${appServer.url}accounts/family-links`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(result).toEqual({
      status: 503,
      body: { type: 'FAMILY_LINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
    });
  });

  test('grants an agent only the selected profiles and digitization task', async () => {
    await traceTo('DI-ACC-005', 'AC-ACC-007', 'AC-ACC-008');
    useAliceSession();
    const grantRequests: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess(command) {
        grantRequests.push(command);
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);

    const result = await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
      tasks: ['digitize-measurement'],
    });

    expect(result).toEqual({
      status: 201,
      body: {
        type: 'AGENT_ACCESS_GRANTED',
        payload: {
          grantorAccountId: 'alice-user',
          agentId: 'digitizer-1',
          memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
          tasks: ['digitize-measurement'],
        },
      },
    });
    expect(grantRequests).toEqual([
      {
        grantorAccountId: 'alice-user',
        agentId: 'digitizer-1',
        memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
        previousMemberIds: [],
        tasks: ['digitize-measurement'],
      },
    ]);
  });

  test('refuses an agent grant for a task outside the digitization boundary', async () => {
    await traceTo('DI-ACC-005');
    useAliceSession();
    let provisioned = false;
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        provisioned = true;
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);

    const result = await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice'],
      tasks: ['manage-family'],
    });

    expect(result).toEqual({ status: 400, body: { code: 'INVALID_AGENT_GRANT' } });
    expect(provisioned).toBe(false);
  });

  test('does not silently discard an unauthorized task from an otherwise valid grant', async () => {
    useAliceSession();
    let provisioned = false;
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        provisioned = true;
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);

    const result = await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice'],
      tasks: ['digitize-measurement', 'manage-family'],
    });

    expect(result).toEqual({ status: 400, body: { code: 'INVALID_AGENT_GRANT' } });
    expect(provisioned).toBe(false);
  });

  test('does not silently discard a malformed member id from an otherwise valid grant', async () => {
    useAliceSession();
    let provisioned = false;
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        provisioned = true;
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);

    const result = await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', 42],
      tasks: ['digitize-measurement'],
    });

    expect(result).toEqual({ status: 400, body: { code: 'INVALID_AGENT_GRANT' } });
    expect(provisioned).toBe(false);
  });

  test('revokes only the selected agent profile while preserving other agent and owner access', async () => {
    await traceTo('DI-ACC-006', 'AC-ACC-009');
    useAliceSession();
    const revocations: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        return { ok: true };
      },
      async deactivateAgentAccess(command) {
        revocations.push(command);
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);
    await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
      tasks: ['digitize-measurement'],
    });

    const result = await postJson(`${appServer.url}accounts/agent-grants/revoke-member`, {
      agentId: 'digitizer-1',
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(result).toEqual({
      status: 200,
      body: {
        type: 'AGENT_MEMBER_ACCESS_REVOKED',
        payload: {
          agentId: 'digitizer-1',
          revokedMemberId: '20000000-0000-4000-8000-000000000002',
          remainingMemberIds: ['alice'],
        },
      },
    });
    expect(revocations).toEqual([
      {
        grantorAccountId: 'alice-user',
        agentId: 'digitizer-1',
        memberId: '20000000-0000-4000-8000-000000000002',
      },
    ]);
  });

  test('replaces an existing agent grant instead of leaving removed profile access active', async () => {
    await traceTo('DI-ACC-005', 'AC-ACC-008', 'AC-ACC-009');
    useAliceSession();
    const grantRequests: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess(command) {
        grantRequests.push(command);
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);
    await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
      tasks: ['digitize-measurement'],
    });

    const result = await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice'],
      tasks: ['digitize-measurement'],
    });

    expect(result).toMatchObject({ status: 201, body: { type: 'AGENT_ACCESS_GRANTED' } });
    expect(grantRequests).toEqual([
      {
        grantorAccountId: 'alice-user',
        agentId: 'digitizer-1',
        memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
        previousMemberIds: [],
        tasks: ['digitize-measurement'],
      },
      {
        grantorAccountId: 'alice-user',
        agentId: 'digitizer-1',
        memberIds: ['alice'],
        previousMemberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
        tasks: ['digitize-measurement'],
      },
    ]);
  });

  test('unlinks a minor only after owner and derivative agent access removal is confirmed', async () => {
    await traceTo('DI-ACC-007', 'AC-ACC-011');
    useAliceSession();
    const unlinkRequests: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        return { ok: true };
      },
      async deactivateFamilyAccess(command) {
        unlinkRequests.push(command);
        return { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);
    await postJson(`${appServer.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
      tasks: ['digitize-measurement'],
    });

    const result = await postJson(`${appServer.url}accounts/family-links/unlink`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(result).toEqual({
      status: 200,
      body: {
        type: 'FAMILY_LINK_ENDED',
        payload: {
          memberId: '20000000-0000-4000-8000-000000000002',
          selectableMembers: [{ resourceType: 'Patient', id: 'alice' }],
        },
      },
    });
    expect(unlinkRequests).toEqual([
      {
        accountId: 'alice-user',
        memberId: '20000000-0000-4000-8000-000000000002',
        derivativeAgentIds: ['digitizer-1'],
      },
    ]);
  });

  test('keeps the family link active when access removal fails', async () => {
    await traceTo('DI-ACC-007', 'AC-ACC-012');
    useAliceSession();
    let unlinkAttempts = 0;
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async deactivateFamilyAccess() {
        unlinkAttempts += 1;
        return unlinkAttempts === 1 ? { ok: false, reason: 'UNAVAILABLE' } : { ok: true };
      },
    };
    const appServer = await createLinkedFamily(provisioner);

    const failed = await postJson(`${appServer.url}accounts/family-links/unlink`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });
    const retried = await postJson(`${appServer.url}accounts/family-links/unlink`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(failed).toEqual({
      status: 503,
      body: { type: 'FAMILY_UNLINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
    });
    expect(retried).toMatchObject({ status: 200, body: { type: 'FAMILY_LINK_ENDED' } });
  });

  test('preserves family and agent authority across repeat onboarding and application reconstruction', async () => {
    await traceTo('DI-ACC-001', 'AC-ACC-011');
    useAliceSession();
    const repository = createInMemoryAccountsRepository();
    const unlinkRequests: unknown[] = [];
    const provisioner: AccountsProvisioner = {
      async createMinorProfile() {
        return { ok: true };
      },
      async activateOwnerAccess() {
        return { ok: true };
      },
      async activateAgentAccess() {
        return { ok: true };
      },
      async deactivateFamilyAccess(command) {
        unlinkRequests.push(command);
        return { ok: true };
      },
    };
    const first = await listen(
      createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner, accountsRepository: repository }))
    );
    await postJson(`${first.url}accounts/onboard`, undefined);
    await postJson(`${first.url}accounts/minor-profiles`, {
      id: '20000000-0000-4000-8000-000000000002',
      identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });
    await postJson(`${first.url}accounts/family-links`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });
    await postJson(`${first.url}accounts/agent-grants`, {
      agentId: 'digitizer-1',
      memberIds: ['alice', '20000000-0000-4000-8000-000000000002'],
      tasks: ['digitize-measurement'],
    });
    await postJson(`${first.url}accounts/onboard`, undefined);

    const reconstructed = await listen(
      createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner, accountsRepository: repository }))
    );
    const result = await postJson(`${reconstructed.url}accounts/family-links/unlink`, {
      memberId: '20000000-0000-4000-8000-000000000002',
    });

    expect(result).toMatchObject({ status: 200, body: { type: 'FAMILY_LINK_ENDED' } });
    expect(unlinkRequests).toEqual([
      {
        accountId: 'alice-user',
        memberId: '20000000-0000-4000-8000-000000000002',
        derivativeAgentIds: ['digitizer-1'],
      },
    ]);
  });
});

async function traceTo(designInput: string, ...acceptanceCriteria: string[]): Promise<void> {
  await allure.epic('Accounts');
  await allure.feature(designInput);
  await Promise.all(acceptanceCriteria.map((id) => allure.label('acceptanceCriterion', id)));
}

async function createLinkedFamily(provisioner: AccountsProvisioner): Promise<{ url: string }> {
  const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner })));
  await postJson(`${appServer.url}accounts/onboard`, undefined);
  await postJson(`${appServer.url}accounts/minor-profiles`, {
    id: '20000000-0000-4000-8000-000000000002',
    identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
    name: { given: ['Charlie'], family: 'Example' },
    birthDate: '2018-03-04',
    relationship: 'parent',
  });
  await postJson(`${appServer.url}accounts/family-links`, {
    memberId: '20000000-0000-4000-8000-000000000002',
  });
  return appServer;
}

function useAliceSession(): void {
  medplum.use(
    http.get(`${medplumBaseUrl}auth/me`, () =>
      HttpResponse.json({
        user: { resourceType: 'User', id: 'alice-user' },
        membership: {
          resourceType: 'ProjectMembership',
          id: 'alice-membership',
          profile: { reference: 'Patient/alice' },
        },
        profile: { resourceType: 'Patient', id: 'alice' },
      })
    )
  );
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer acceptance-token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function postOnboardAccount(): Promise<{ status: number; body: unknown }> {
  const appServer = await listen(createServer(createAccountsHttpApp({ medplumBaseUrl })));
  const response = await fetch(`${appServer.url}accounts/onboard`, {
    method: 'POST',
    headers: { authorization: 'Bearer acceptance-token' },
  });
  return { status: response.status, body: await response.json() };
}

async function listen(server: Server): Promise<{ url: string }> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/` };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
