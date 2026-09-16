// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { LoginAuthenticationResponse } from '@medplum/core';
import { createReference, MedplumClient } from '@medplum/core';
import type { AccessPolicy, Patient, ProjectMembership, ResourceType } from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAccountsHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/http/accountsHttpApp';
import { createKeycloakAccountIdentityProvider } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/keycloak/keycloakAccountIdentityProvider';
import { createMedplumAccountsProvisioner } from '../../../examples/medplum-health-tracking/src/contexts/accounts/infra/medplum/medplumAccountsProvisioner';

const runDockerAcceptance = process.env['MEDPLUM_DOCKER_ACCEPTANCE'] === '1';
const medplumBaseUrl = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const keycloakBaseUrl = process.env['KEYCLOAK_BASE_URL'] ?? 'http://localhost:8180/';
const keycloakRealm = 'family-wellness';
const keycloakPatientIdentifierSystem = 'https://family.example/identity/keycloak-sub';
const createdResources: { resourceType: ResourceType; id: string }[] = [];
let admin: MedplumClient;
let owner: MedplumClient;
let agent: MedplumClient;
let appServer: Server | undefined;
let appUrl: string;
let ownerPolicy: AccessPolicy;
let agentPolicy: AccessPolicy;
let ownerMembership: ProjectMembership;
let agentMembership: ProjectMembership;
let ownerPatientId: string;
let ownerAccountId: string;
let agentAccountId: string;
let ownerKeycloakToken: string;
let ownerKeycloakSubject: string;

describe.skipIf(!runDockerAcceptance)('Accounts HTTP API — Docker Medplum', () => {
  beforeAll(async () => {
    admin = await loginToDockerMedplum({
      email: process.env['MEDPLUM_ACCEPTANCE_EMAIL'] ?? 'admin@example.com',
      password: process.env['MEDPLUM_ACCEPTANCE_PASSWORD'] ?? 'medplum_admin',
      projectDisplay: 'Accounts Acceptance',
    });
    await admin.getProfileAsync();
    const project = admin.getProject();
    if (!project?.id) {
      throw new Error('Docker Medplum session has no project');
    }

    ownerPolicy = await admin.createResource<AccessPolicy>({
      resourceType: 'AccessPolicy',
      name: `Accounts owner ${randomUUID()}`,
      resource: [],
    });
    agentPolicy = await admin.createResource<AccessPolicy>({
      resourceType: 'AccessPolicy',
      name: `Accounts agent ${randomUUID()}`,
      resource: [],
    });
    track(ownerPolicy);
    track(agentPolicy);

    const ownerCredentials = await inviteUser(project.id, 'Patient', ownerPolicy, 'Alice', 'Owner');
    const agentCredentials = await inviteUser(project.id, 'Practitioner', agentPolicy, 'Digitization', 'Agent');
    ownerMembership = ownerCredentials.membership;
    agentMembership = agentCredentials.membership;
    ownerPatientId = referenceId(ownerMembership.profile?.reference);
    ownerAccountId = referenceId(ownerMembership.user?.reference);
    agentAccountId = referenceId(agentMembership.user?.reference);
    const keycloakAuthentication = await loginToDockerKeycloak();
    ownerKeycloakToken = keycloakAuthentication.accessToken;
    ownerKeycloakSubject = keycloakAuthentication.subject;

    const ownerPatient = await admin.readResource<Patient>('Patient', ownerPatientId);
    await admin.updateResource<Patient>({
      ...ownerPatient,
      identifier: [
        ...(ownerPatient.identifier ?? []).filter(
          (identifier) => identifier.system !== keycloakPatientIdentifierSystem
        ),
        { system: keycloakPatientIdentifierSystem, value: ownerKeycloakSubject },
      ],
    });

    ownerPolicy = await admin.updateResource<AccessPolicy>({
      ...ownerPolicy,
      resource: memberRules(ownerPatientId, false),
    });
    owner = await loginToDockerMedplum({
      email: ownerCredentials.email,
      password: ownerCredentials.password,
      projectDisplay: project.name,
      projectId: project.id,
    });
    agent = await loginToDockerMedplum({
      email: agentCredentials.email,
      password: agentCredentials.password,
      projectDisplay: project.name,
      projectId: project.id,
    });

    const provisioner = createMedplumAccountsProvisioner({
      baseUrl: medplumBaseUrl,
      accessToken: requiredToken(admin),
      ownerPolicyIdByAccountId: new Map([[ownerKeycloakSubject, ownerPolicy.id]]),
      agentPolicyIdByAgentId: new Map([[agentAccountId, agentPolicy.id]]),
      onError: (error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
    });
    const identityProvider = createKeycloakAccountIdentityProvider({
      keycloakBaseUrl,
      realm: keycloakRealm,
      medplumBaseUrl,
      medplumAccessToken: requiredToken(admin),
      patientIdentifierSystem: keycloakPatientIdentifierSystem,
    });
    const listening = await listen(
      createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner, identityProvider }))
    );
    appServer = listening.server;
    appUrl = listening.url;
  }, 60_000);

  afterAll(async () => {
    await closeServer(appServer);
    if (!admin) {
      return;
    }
    const deletionPriority: Partial<Record<ResourceType, number>> = {
      ProjectMembership: 0,
      Observation: 1,
      Patient: 2,
      Practitioner: 2,
      AccessPolicy: 3,
    };
    createdResources.sort(
      (left, right) => (deletionPriority[left.resourceType] ?? 10) - (deletionPriority[right.resourceType] ?? 10)
    );
    for (const resource of createdResources) {
      await admin.deleteResource(resource.resourceType, resource.id).catch(() => undefined);
    }
  }, 30_000);

  test('enforces the complete Accounts lifecycle against real Patients and AccessPolicies', async () => {
    await allure.epic('UN-ACC-001–004');
    await allure.feature('DI-ACC-001–007');
    await Promise.all(
      ['001', '002', '003', '004', '005', '007', '008', '009', '010', '011'].map((id) =>
        allure.label('acceptanceCriterion', `AC-ACC-${id}`)
      )
    );
    await allure.label('environment', 'docker-medplum');

    const proposedMinorId = randomUUID();
    const identifier = { system: 'https://family.example/member-id', value: `charlie-${randomUUID()}` };
    expect(await postAsOwner('accounts/onboard')).toMatchObject({ status: 200 });
    const createdMinor = await postAsOwner('accounts/minor-profiles', {
      id: proposedMinorId,
      identifier,
      name: { given: ['Charlie'], family: 'Acceptance' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });
    expect(createdMinor).toMatchObject({ status: 201, body: { type: 'MINOR_PROFILE_CREATED' } });
    const minorId = minorIdFrom(createdMinor.body);
    createdResources.push({ resourceType: 'Patient', id: minorId });

    const duplicate = await postAsOwner('accounts/minor-profiles', {
      id: randomUUID(),
      identifier,
      name: { given: ['Duplicate'], family: 'Acceptance' },
      birthDate: '2018-03-04',
      relationship: 'parent',
    });
    expect(duplicate).toEqual({
      status: 409,
      body: { type: 'MINOR_PROFILE_CREATION_REJECTED', payload: { reason: 'IDENTIFIER_COLLISION' } },
    });

    expect(await postAsOwner('accounts/family-links', { memberId: minorId })).toMatchObject({
      status: 201,
      body: { type: 'FAMILY_LINK_ACTIVATED' },
    });
    expect(
      await postAsOwner('accounts/agent-grants', {
        agentId: agentAccountId,
        memberIds: [ownerPatientId, minorId],
        tasks: ['digitize-measurement'],
      })
    ).toMatchObject({ status: 201, body: { type: 'AGENT_ACCESS_GRANTED' } });

    expect((await createObservation(agent, minorId)).status).toBe(201);
    expect(
      await postAsOwner('accounts/agent-grants/revoke-member', { agentId: agentAccountId, memberId: minorId })
    ).toMatchObject({ status: 200, body: { type: 'AGENT_MEMBER_ACCESS_REVOKED' } });

    const delayedAgentSave = await createObservation(agent, minorId);
    const retainedAgentSave = await createObservation(agent, ownerPatientId);
    const retainedOwnerSave = await createObservation(owner, minorId);
    expect(delayedAgentSave.status).toBe(403);
    expect(retainedAgentSave.status).toBe(201);
    expect(retainedOwnerSave.status).toBe(201);

    expect(await postAsOwner('accounts/family-links/unlink', { memberId: minorId })).toMatchObject({
      status: 200,
      body: { type: 'FAMILY_LINK_ENDED' },
    });
    const ownerAfterUnlink = await createObservation(owner, minorId);
    expect(ownerAfterUnlink.status).toBe(403);

    await allure.attachment(
      'Accounts Docker lifecycle evidence',
      JSON.stringify(
        {
          ownerAccountId,
          ownerKeycloakSubject,
          agentAccountId,
          ownerPatientId,
          minorId,
          duplicate,
          delayedAgentSave,
          retainedAgentSave,
          retainedOwnerSave,
          ownerAfterUnlink,
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );
  }, 60_000);
});

async function inviteUser(
  projectId: string,
  resourceType: 'Patient' | 'Practitioner',
  policy: AccessPolicy,
  firstName: string,
  lastName: string
): Promise<{ membership: ProjectMembership; email: string; password: string }> {
  const email = `accounts-${randomUUID()}@example.com`;
  const password = `Acceptance-${randomUUID()}`;
  const membership = await admin.invite(projectId, {
    resourceType,
    firstName,
    lastName,
    email,
    password,
    sendEmail: false,
    accessPolicy: createReference(policy),
  });
  if (membership.resourceType !== 'ProjectMembership' || !membership.id) {
    throw new Error('Could not create Accounts acceptance user');
  }
  track(membership);
  const profileId = referenceId(membership.profile?.reference);
  createdResources.push({ resourceType, id: profileId });
  return { membership, email, password };
}

async function postAsOwner(path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL(path, appUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerKeycloakToken}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function loginToDockerKeycloak(): Promise<{ accessToken: string; subject: string }> {
  const response = await fetch(new URL(`realms/${keycloakRealm}/protocol/openid-connect/token`, keycloakBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
        client_id: 'accounts-api',
        username: 'alice',
        password: 'alice-password',
        scope: 'openid',
      }),
  });
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new Error(`Keycloak token request failed with HTTP ${response.status}`);
  }
  const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1] ?? '', 'base64url').toString()) as {
    sub?: unknown;
  };
  if (typeof payload.sub !== 'string') {
    throw new Error('Keycloak access token has no subject');
  }
  return { accessToken: tokens.access_token, subject: payload.sub };
}

async function createObservation(client: MedplumClient, patientId: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(new URL('fhir/R4/Observation', medplumBaseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${requiredToken(client)}`, 'content-type': 'application/fhir+json' },
    body: JSON.stringify({
      resourceType: 'Observation',
      status: 'final',
      code: { text: 'Digitized weight' },
      subject: { reference: `Patient/${patientId}` },
      valueQuantity: { value: 32.4, unit: 'kg' },
    }),
  });
  const responseBody = (await response.json()) as { id?: string };
  if (response.status === 200 || response.status === 201) {
    if (!responseBody.id) {
      throw new Error('Created Observation has no id');
    }
    createdResources.push({ resourceType: 'Observation', id: responseBody.id });
  }
  return { status: response.status, body: responseBody };
}

function memberRules(patientId: string, createOnly: boolean): NonNullable<AccessPolicy['resource']> {
  return [
    {
      resourceType: 'Patient',
      criteria: `Patient?_id=${patientId}`,
      interaction: ['read', 'search'],
    },
    {
      resourceType: 'Observation',
      criteria: `Observation?subject=Patient/${patientId}`,
      interaction: createOnly ? ['create'] : ['create', 'read', 'search'],
    },
  ];
}

function track(resource: { resourceType: ResourceType; id: string }): void {
  createdResources.push({ resourceType: resource.resourceType, id: resource.id });
}

function referenceId(reference: string | undefined): string {
  const id = reference?.split('/')[1];
  if (!id) {
    throw new Error(`Expected a resource reference, received ${reference ?? 'undefined'}`);
  }
  return id;
}

function minorIdFrom(body: unknown): string {
  const event = body as { payload?: { member?: { id?: unknown } } };
  if (typeof event.payload?.member?.id !== 'string') {
    throw new Error('Minor profile response has no Patient id');
  }
  return event.payload.member.id;
}

function requiredToken(client: MedplumClient): string {
  const token = client.getAccessToken();
  if (!token) {
    throw new Error('Medplum session has no access token');
  }
  return token;
}

async function loginToDockerMedplum(credentials: {
  email: string;
  password: string;
  projectDisplay?: string;
  projectId?: string;
}): Promise<MedplumClient> {
  const loginClient = new MedplumClient({ baseUrl: medplumBaseUrl });
  const codeVerifier = `accounts-${randomUUID()}`;
  let login = await loginClient.startLogin({
    email: credentials.email,
    password: credentials.password,
    scope: 'openid',
    codeChallenge: codeVerifier,
    codeChallengeMethod: 'plain',
    projectId: credentials.projectId,
  });
  if (!login.code) {
    const membership =
      login.memberships?.find((item) => item.project?.display === credentials.projectDisplay) ?? login.memberships?.[0];
    if (
      credentials.projectDisplay &&
      !login.memberships?.some((item) => item.project?.display === credentials.projectDisplay)
    ) {
      login = await loginClient.startNewProject({ login: login.login, projectName: credentials.projectDisplay });
    } else {
      if (!membership?.id) {
        throw new Error('Docker Medplum login returned no selectable membership');
      }
      login = await loginClient.post<LoginAuthenticationResponse>('auth/profile', {
        login: login.login,
        profile: membership.id,
      });
    }
  }
  if (!login.code) {
    throw new Error('Docker Medplum login returned no authorization code');
  }
  const tokenResponse = await fetch(new URL('oauth2/token', medplumBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: login.code, code_verifier: codeVerifier }),
  });
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new Error(`Docker Medplum token exchange failed with HTTP ${tokenResponse.status}`);
  }
  return new MedplumClient({ baseUrl: medplumBaseUrl, accessToken: tokens.access_token });
}

async function listen(server: Server): Promise<{ server: Server; url: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
