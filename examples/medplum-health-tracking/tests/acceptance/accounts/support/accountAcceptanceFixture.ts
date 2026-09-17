// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { LoginAuthenticationResponse } from '@medplum/core';
import { createReference, MedplumClient } from '@medplum/core';
import type {
  AccessPolicy,
  Bot,
  Identifier,
  Observation,
  Patient,
  Provenance,
  ProjectMembership,
  Resource,
  ResourceType,
} from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateMinorProfileRequest } from '../../../../src/contexts/accounts/application/contracts/accountsApi';
import { createAccountsHttpApp } from '../../../../src/contexts/accounts/infra/http/accountsHttpApp';
import { createKeycloakAccountIdentityProvider } from '../../../../src/contexts/accounts/infra/keycloak/keycloakAccountIdentityProvider';
import { createMedplumAccountsProvisioner } from '../../../../src/contexts/accounts/infra/medplum/medplumAccountsProvisioner';
import { createMedplumAccountsState } from '../../../../src/contexts/accounts/infra/medplum/medplumAccountsState';

const DEFAULT_MEDPLUM_BASE_URL = 'http://localhost:8103/';
const DEFAULT_KEYCLOAK_BASE_URL = 'http://localhost:8180/';
const KEYCLOAK_REALM = 'family-wellness';
const KEYCLOAK_PATIENT_IDENTIFIER_SYSTEM = 'https://family.example/identity/keycloak-sub';
const OBSERVATION_IDENTIFIER_SYSTEM = 'https://family.example/test/observation-id';

// Medplum login transactions for one email are single-use and invalidate each
// other when startLogin/startNewProject overlap. Only that shared bootstrap is
// serialized; every project-scoped fixture proceeds independently afterwards.
let adminProjectCreationQueue = Promise.resolve();

/** A deliberately invalid credential for exercising real Medplum provisioning failures. */
export const INVALID_PROVISIONER_ACCESS_TOKEN = 'invalid-account-provisioner-access-token';

export type AccountApiResponse<TBody = unknown> = {
  readonly status: number;
  readonly body: TBody;
};

export type ObservationSubmission = AccountApiResponse & {
  /** Unique search token assigned before submission, including for rejected writes. */
  readonly identifier: Identifier;
  readonly observationId?: string;
};

export type AccountAcceptanceFixtureOptions = {
  readonly projectDisplay?: string;
  readonly medplumBaseUrl?: string;
  readonly keycloakBaseUrl?: string;
};

export type AccountAcceptanceFixture = {
  /** Stable W3C trace ID attached to every request issued by this scenario. */
  readonly correlationTraceId: string;
  readonly medplumBaseUrl: string;
  readonly admin: MedplumClient;
  readonly alice: MedplumClient;
  readonly digitizationBot: Bot & { readonly id: string };
  readonly aliceMembership: ProjectMembership;
  readonly digitizationBotMembership: ProjectMembership;
  readonly alicePatientId: string;
  readonly aliceAccountId: string;
  readonly digitizationBotId: string;
  readonly aliceKeycloakSubject: string;
  readonly alicePolicyId: string;
  readonly digitizationBotPolicyId: string;
  postAsAlice<TBody = unknown>(path: string, body?: unknown): Promise<AccountApiResponse<TBody>>;
  createMinorProfile(
    input?: Partial<Omit<CreateMinorProfileRequest, 'relationship'>> &
      Pick<Partial<CreateMinorProfileRequest>, 'relationship'>
  ): Promise<{ readonly id: string; readonly response: AccountApiResponse }>;
  createLinkedMinor(): Promise<{ readonly id: string; readonly response: AccountApiResponse }>;
  createObservationAsAlice(patientId: string, observation?: Partial<Observation>): Promise<ObservationSubmission>;
  createObservationAsDigitizationBot(
    patientId: string,
    observation?: Partial<Observation>
  ): Promise<ObservationSubmission>;
  createPatientAsDigitizationBot(): Promise<AccountApiResponse>;
  createProvenanceAsDigitizationBot(patientId: string): Promise<AccountApiResponse>;
  findObservations(identifier: Identifier): Promise<Observation[]>;
  observationWasPersisted(identifier: Identifier): Promise<boolean>;
  readAlicePolicy(): Promise<AccessPolicy>;
  readDigitizationBotPolicy(): Promise<AccessPolicy>;
  /** Restarts only the Account HTTP adapter; domain state and all acceptance resources are retained. */
  restartWithProvisionerAccessToken(accessToken: string): Promise<void>;
  restartWithProvisionerPolicyIds(policyIds: {
    readonly ownerPolicyId: string;
    readonly agentPolicyId: string;
  }): Promise<void>;
  track(resource: { readonly resourceType: ResourceType; readonly id: string }): void;
  cleanup(): Promise<void>;
};

/**
 * Creates one isolated full-stack acceptance environment.
 *
 * Every invocation owns a unique Medplum project, policies, users, resources, and
 * ephemeral HTTP server. The shared Keycloak Alice is used read-only; its subject
 * is resolved through the fixture's project-scoped Medplum administrator token.
 *
 * @param options - Optional service endpoints and project display prefix.
 * @returns A fixture whose resources and Account server are isolated to this invocation.
 */
export async function createAccountAcceptanceFixture(
  options: AccountAcceptanceFixtureOptions = {}
): Promise<AccountAcceptanceFixture> {
  const medplumBaseUrl = options.medplumBaseUrl ?? process.env['MEDPLUM_BASE_URL'] ?? DEFAULT_MEDPLUM_BASE_URL;
  const keycloakBaseUrl = options.keycloakBaseUrl ?? process.env['KEYCLOAK_BASE_URL'] ?? DEFAULT_KEYCLOAK_BASE_URL;
  const createdResources = new Map<string, { readonly resourceType: ResourceType; readonly id: string }>();
  const projectDisplay = `${options.projectDisplay ?? 'Accounts Acceptance'} ${randomUUID()}`;
  const correlationTraceId = randomUUID().replaceAll('-', '');
  await allure.label('traceId', correlationTraceId);
  process.stdout.write(`Account acceptance scenario ${projectDisplay} traceId=${correlationTraceId}\n`);
  let cleanedUp = false;

  const track: AccountAcceptanceFixture['track'] = (resource) => {
    createdResources.set(`${resource.resourceType}/${resource.id}`, resource);
  };

  const admin = await withAdminProjectCreationLock(medplumBaseUrl, () =>
    loginToMedplum(
      medplumBaseUrl,
      {
        email: process.env['MEDPLUM_ACCEPTANCE_EMAIL'] ?? 'admin@example.com',
        password: process.env['MEDPLUM_ACCEPTANCE_PASSWORD'] ?? 'medplum_admin',
        projectDisplay,
      },
      correlationTraceId
    )
  );
  await admin.getProfileAsync();
  const project = admin.getProject();
  if (!project?.id) {
    throw new Error('full-stack Medplum session has no project');
  }
  track({ resourceType: 'Project', id: project.id });

  let alicePolicy = await admin.createResource<AccessPolicy>({
    resourceType: 'AccessPolicy',
    name: `Accounts owner ${randomUUID()}`,
    resource: [],
  });
  const digitizationBotPolicy = await admin.createResource<AccessPolicy>({
    resourceType: 'AccessPolicy',
    name: `Accounts digitizer ${randomUUID()}`,
    resource: [],
  });
  track(alicePolicy);
  track(digitizationBotPolicy);

  const aliceCredentials = await inviteUser(admin, project.id, 'Patient', alicePolicy, 'Alice', 'Owner', track);
  const aliceMembership = aliceCredentials.membership;
  const alicePatientId = referenceId(aliceMembership.profile?.reference);
  const aliceAccountId = referenceId(aliceMembership.user?.reference);
  const digitizationBot = await createDigitizationBot(admin, project.id, digitizationBotPolicy, track);
  const digitizationBotMembership = await admin.searchOne('ProjectMembership', {
    profile: `Bot/${digitizationBot.id}`,
  });
  if (!digitizationBotMembership?.id) {
    throw new Error('Could not find the Digitization Bot project membership');
  }
  track(digitizationBotMembership);
  const digitizationBotId = digitizationBot.id;
  const keycloakAuthentication = await loginToKeycloak(keycloakBaseUrl, correlationTraceId);

  const alicePatient = await admin.readResource('Patient', alicePatientId);
  await admin.updateResource({
    ...alicePatient,
    identifier: [
      ...(alicePatient.identifier ?? []).filter(
        (identifier) => identifier.system !== KEYCLOAK_PATIENT_IDENTIFIER_SYSTEM
      ),
      { system: KEYCLOAK_PATIENT_IDENTIFIER_SYSTEM, value: keycloakAuthentication.subject },
    ],
  });

  alicePolicy = await admin.updateResource<AccessPolicy>({
    ...alicePolicy,
    resource: memberRules(alicePatientId, false),
  });
  const alice = await loginToMedplum(
    medplumBaseUrl,
    {
      email: aliceCredentials.email,
      password: aliceCredentials.password,
      projectDisplay: project.name,
      projectId: project.id,
    },
    correlationTraceId
  );
  const accountsRepository = createMedplumAccountsState({
    baseUrl: medplumBaseUrl,
    accessToken: requiredToken(admin),
    accountIdentifierSystem: KEYCLOAK_PATIENT_IDENTIFIER_SYSTEM,
    ownerPolicyIdByAccountId: new Map([[keycloakAuthentication.subject, alicePolicy.id]]),
    agentPolicyIdByAgentId: new Map([[digitizationBotId, digitizationBotPolicy.id]]),
  });
  const identityProvider = createKeycloakAccountIdentityProvider({
    keycloakBaseUrl,
    realm: KEYCLOAK_REALM,
    medplumBaseUrl,
    medplumAccessToken: requiredToken(admin),
    patientIdentifierSystem: KEYCLOAK_PATIENT_IDENTIFIER_SYSTEM,
  });
  let listening = await startAccountServer(requiredToken(admin));

  async function startAccountServer(
    provisionerAccessToken: string,
    policyIds: { readonly ownerPolicyId: string; readonly agentPolicyId: string } = {
      ownerPolicyId: alicePolicy.id,
      agentPolicyId: digitizationBotPolicy.id,
    }
  ): Promise<ListeningServer> {
    const provisioner = createMedplumAccountsProvisioner({
      baseUrl: medplumBaseUrl,
      accessToken: provisionerAccessToken,
      ownerPolicyIdByAccountId: new Map([[keycloakAuthentication.subject, policyIds.ownerPolicyId]]),
      agentPolicyIdByAgentId: new Map([[digitizationBotId, policyIds.agentPolicyId]]),
      onError: (error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
    });
    return listen(
      createServer(createAccountsHttpApp({ medplumBaseUrl, provisioner, identityProvider, accountsRepository }))
    );
  }

  const postAsAlice: AccountAcceptanceFixture['postAsAlice'] = async <TBody = unknown>(
    path: string,
    body?: unknown
  ) => {
    const response = await fetch(new URL(path, listening.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${keycloakAuthentication.accessToken}`,
        'content-type': 'application/json',
        ...correlationHeaders(correlationTraceId),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as TBody };
  };

  const createMinorProfile: AccountAcceptanceFixture['createMinorProfile'] = async (input) => {
    const response = await postAsAlice('accounts/minor-profiles', {
      id: input?.id ?? randomUUID(),
      identifier: input?.identifier ?? {
        system: 'https://family.example/member-id',
        value: `charlie-${randomUUID()}`,
      },
      name: input?.name ?? { given: ['Charlie'], family: 'Acceptance' },
      birthDate: input?.birthDate ?? '2018-03-04',
      relationship: input?.relationship ?? 'parent',
    });
    const id = minorIdFrom(response.body);
    track({ resourceType: 'Patient', id });
    return { id, response };
  };

  const createLinkedMinor = async (): Promise<{ readonly id: string; readonly response: AccountApiResponse }> => {
    const minor = await createMinorProfile();
    const response = await postAsAlice('accounts/family-links', { memberId: minor.id });
    if (response.status !== 201) {
      throw new Error(`Could not link acceptance minor: HTTP ${response.status}`);
    }
    return { id: minor.id, response };
  };

  const buildObservation = (
    patientId: string,
    observation: Partial<Observation> = {}
  ): { readonly identifier: Identifier; readonly observation: Observation } => {
    const identifier = observation.identifier?.[0] ?? {
      system: OBSERVATION_IDENTIFIER_SYSTEM,
      value: randomUUID(),
    };
    if (!identifier.system || !identifier.value) {
      throw new Error('Acceptance Observation identifier requires both system and value');
    }
    return {
      identifier,
      observation: {
        resourceType: 'Observation',
        status: 'final',
        code: { text: 'Digitized weight' },
        subject: { reference: `Patient/${patientId}` },
        valueQuantity: { value: 32.4, unit: 'kg' },
        ...observation,
        identifier: [identifier],
      },
    };
  };

  const submitObservationAsAlice = async (
    patientId: string,
    observation: Partial<Observation> = {}
  ): Promise<ObservationSubmission> => {
    const built = buildObservation(patientId, observation);
    const response = await fetch(new URL('fhir/R4/Observation', medplumBaseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requiredToken(alice)}`,
        'content-type': 'application/fhir+json',
        ...correlationHeaders(correlationTraceId),
      },
      body: JSON.stringify(built.observation),
    });
    const body = (await response.json()) as unknown;
    const observationId = isCreatedObservation(response.status, body) ? body.id : undefined;
    if (observationId) {
      track({ resourceType: 'Observation', id: observationId });
    }
    return { status: response.status, body, identifier: built.identifier, ...(observationId ? { observationId } : {}) };
  };

  const executeDigitizationBot = async (input: Resource): Promise<AccountApiResponse> => {
    const response = await fetch(new URL(`fhir/R4/Bot/${digitizationBot.id}/$execute`, medplumBaseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requiredToken(admin)}`,
        'content-type': 'application/fhir+json',
        ...correlationHeaders(correlationTraceId),
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      return { status: response.status, body };
    }
    if (!isAccountApiResponse(body)) {
      throw new Error('Digitization Bot returned an invalid execution result');
    }
    if (body.status === 200 || body.status === 201) {
      const resource = body.body as Partial<Resource>;
      if (resource.resourceType && resource.id) {
        track({ resourceType: resource.resourceType, id: resource.id });
      }
    }
    return body;
  };

  const submitObservationAsDigitizationBot = async (
    patientId: string,
    observation: Partial<Observation> = {}
  ): Promise<ObservationSubmission> => {
    const built = buildObservation(patientId, observation);
    const result = await executeDigitizationBot(built.observation);
    const observationId = isCreatedObservation(result.status, result.body) ? result.body.id : undefined;
    return {
      ...result,
      identifier: built.identifier,
      ...(observationId ? { observationId } : {}),
    };
  };

  const findObservations = async (identifier: Identifier): Promise<Observation[]> => {
    if (!identifier.system || !identifier.value) {
      throw new Error('Observation search identifier requires both system and value');
    }
    return admin.searchResources('Observation', {
      identifier: `${identifier.system}|${identifier.value}`,
    });
  };

  return {
    correlationTraceId,
    medplumBaseUrl,
    admin,
    alice,
    digitizationBot,
    aliceMembership,
    digitizationBotMembership,
    alicePatientId,
    aliceAccountId,
    digitizationBotId,
    aliceKeycloakSubject: keycloakAuthentication.subject,
    alicePolicyId: alicePolicy.id,
    digitizationBotPolicyId: digitizationBotPolicy.id,
    postAsAlice,
    createMinorProfile,
    createLinkedMinor,
    createObservationAsAlice: submitObservationAsAlice,
    createObservationAsDigitizationBot: submitObservationAsDigitizationBot,
    createPatientAsDigitizationBot: () =>
      executeDigitizationBot({ resourceType: 'Patient', active: true } satisfies Patient),
    createProvenanceAsDigitizationBot: (patientId) =>
      executeDigitizationBot({
        resourceType: 'Provenance',
        recorded: new Date().toISOString(),
        target: [{ reference: `Patient/${patientId}` }],
        agent: [{ who: { reference: `Bot/${digitizationBot.id}` } }],
      } satisfies Provenance),
    findObservations,
    async observationWasPersisted(identifier): Promise<boolean> {
      return (await findObservations(identifier)).length > 0;
    },
    readAlicePolicy: () => admin.readResource('AccessPolicy', alicePolicy.id),
    readDigitizationBotPolicy: () => admin.readResource('AccessPolicy', digitizationBotPolicy.id),
    async restartWithProvisionerAccessToken(accessToken): Promise<void> {
      await closeServer(listening.server);
      listening = await startAccountServer(accessToken);
    },
    async restartWithProvisionerPolicyIds(policyIds): Promise<void> {
      await closeServer(listening.server);
      listening = await startAccountServer(requiredToken(admin), policyIds);
    },
    track,
    async cleanup(): Promise<void> {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      await closeServer(listening.server);
      const deletionPriority: Partial<Record<ResourceType, number>> = {
        ProjectMembership: 0,
        Provenance: 1,
        Observation: 2,
        Patient: 3,
        Bot: 4,
        Binary: 5,
        AccessPolicy: 6,
        User: 7,
        Project: 8,
      };
      const resources = [...createdResources.values()].sort(
        (left, right) => (deletionPriority[left.resourceType] ?? 10) - (deletionPriority[right.resourceType] ?? 10)
      );
      for (const resource of resources) {
        await admin.deleteResource(resource.resourceType, resource.id).catch(() => undefined);
      }
    },
  };
}

async function createDigitizationBot(
  admin: MedplumClient,
  projectId: string,
  policy: AccessPolicy,
  track: AccountAcceptanceFixture['track']
): Promise<Bot & { readonly id: string }> {
  const executableCode = `
const { getStatus } = require('@medplum/core');

exports.handler = async function (medplum, event) {
  try {
    const created = await medplum.createResource(event.input);
    return { status: 201, body: created };
  } catch (error) {
    const outcome = error && typeof error === 'object' ? error.outcome : undefined;
    return {
      status: outcome ? getStatus(outcome) : 500,
      body: outcome ?? { message: error instanceof Error ? error.message : String(error) },
    };
  }
};
`;
  const bot = await admin.post<Bot>(`admin/projects/${projectId}/bot`, {
    name: `Accounts Digitization Bot ${randomUUID()}`,
    description: 'Acceptance Bot that submits one requested FHIR resource under its own restricted policy',
    accessPolicy: createReference(policy),
    runtimeVersion: 'vmcontext',
    executableCode: {
      contentType: 'application/javascript',
      title: 'digitization-bot.cjs',
      data: Buffer.from(executableCode).toString('base64'),
    },
  });
  if (!bot.id) {
    throw new Error('Could not create Accounts Digitization Bot');
  }
  track({ resourceType: 'Bot', id: bot.id });
  for (const attachment of [bot.sourceCode, bot.executableCode]) {
    if (attachment?.url?.startsWith('Binary/')) {
      track({ resourceType: 'Binary', id: referenceId(attachment.url) });
    }
  }
  return bot as Bot & { readonly id: string };
}

async function inviteUser(
  admin: MedplumClient,
  projectId: string,
  resourceType: 'Patient' | 'Practitioner',
  policy: AccessPolicy,
  firstName: string,
  lastName: string,
  track: AccountAcceptanceFixture['track']
): Promise<{ readonly membership: ProjectMembership; readonly email: string; readonly password: string }> {
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
  track({ resourceType: 'ProjectMembership', id: membership.id });
  track({ resourceType, id: referenceId(membership.profile?.reference) });
  track({ resourceType: 'User', id: referenceId(membership.user?.reference) });
  return { membership, email, password };
}

async function loginToKeycloak(
  keycloakBaseUrl: string,
  traceId: string
): Promise<{ readonly accessToken: string; readonly subject: string }> {
  const response = await fetch(new URL(`realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, keycloakBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...correlationHeaders(traceId) },
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

export function referenceId(reference: string | undefined): string {
  const id = reference?.split('/')[1];
  if (!id) {
    throw new Error(`Expected a resource reference, received ${reference ?? 'undefined'}`);
  }
  return id;
}

export function minorIdFrom(body: unknown): string {
  const event = body as { payload?: { member?: { id?: unknown } } };
  if (typeof event.payload?.member?.id !== 'string') {
    throw new Error('Minor profile response has no Patient id');
  }
  return event.payload.member.id;
}

export function requiredToken(client: MedplumClient): string {
  const token = client.getAccessToken();
  if (!token) {
    throw new Error('Medplum session has no access token');
  }
  return token;
}

async function loginToMedplum(
  medplumBaseUrl: string,
  credentials: {
    readonly email: string;
    readonly password: string;
    readonly projectDisplay?: string;
    readonly projectId?: string;
  },
  traceId: string
): Promise<MedplumClient> {
  const loginClient = new MedplumClient({ baseUrl: medplumBaseUrl });
  const codeVerifier = `accounts-${randomUUID()}`;
  let login = await withLoginRateLimitRetry(() =>
    loginClient.startLogin(
      {
        email: credentials.email,
        password: credentials.password,
        scope: 'openid',
        codeChallenge: codeVerifier,
        codeChallengeMethod: 'plain',
        projectId: credentials.projectId ?? (credentials.projectDisplay ? 'new' : undefined),
      },
      { headers: correlationHeaders(traceId) }
    )
  );
  if (!login.code) {
    const membership =
      login.memberships?.find((item) => item.project?.display === credentials.projectDisplay) ?? login.memberships?.[0];
    if (
      credentials.projectDisplay &&
      !login.memberships?.some((item) => item.project?.display === credentials.projectDisplay)
    ) {
      login = await withLoginRateLimitRetry(() =>
        loginClient.startNewProject(
          { login: login.login, projectName: credentials.projectDisplay as string },
          { headers: correlationHeaders(traceId) }
        )
      );
    } else {
      if (!membership?.id) {
        throw new Error('full-stack Medplum login returned no selectable membership');
      }
      login = await withLoginRateLimitRetry(() =>
        loginClient.post<LoginAuthenticationResponse>(
          'auth/profile',
          { login: login.login, profile: membership.id },
          undefined,
          { headers: correlationHeaders(traceId) }
        )
      );
    }
  }
  if (!login.code) {
    throw new Error('full-stack Medplum login returned no authorization code');
  }
  const tokenResponse = await fetch(new URL('oauth2/token', medplumBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...correlationHeaders(traceId) },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: login.code,
      code_verifier: codeVerifier,
    }),
  });
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new Error(`full-stack Medplum token exchange failed with HTTP ${tokenResponse.status}`);
  }
  return new MedplumClient({ baseUrl: medplumBaseUrl, accessToken: tokens.access_token });
}

async function withLoginRateLimitRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delay = Number(/"_msBeforeNext":(\d+)/.exec(message)?.[1]);
      if (!message.includes('Too Many Requests') || !Number.isFinite(delay) || delay > 60_000 || attempt === 3) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay + 250);
      });
    }
  }
  throw new Error('Unreachable login retry state');
}

async function withAdminProjectCreationLock<T>(medplumBaseUrl: string, operation: () => Promise<T>): Promise<T> {
  const previous = adminProjectCreationQueue;
  let release!: () => void;
  adminProjectCreationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await withCrossWorkerAdminProjectCreationLock(medplumBaseUrl, operation);
  } finally {
    release();
  }
}

async function withCrossWorkerAdminProjectCreationLock<T>(
  medplumBaseUrl: string,
  operation: () => Promise<T>
): Promise<T> {
  const serverKey = Buffer.from(new URL(medplumBaseUrl).origin).toString('base64url');
  const lockPath = join(tmpdir(), `medplum-account-admin-project-${serverKey}.lock`);
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      let lockAge: number;
      try {
        lockAge = Date.now() - (await stat(lockPath)).mtimeMs;
      } catch (statError) {
        if (isErrorCode(statError, 'ENOENT')) {
          continue;
        }
        throw statError;
      }
      if (lockAge > 120_000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return isErrorCode(error, 'EEXIST');
}

function isErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

type ListeningServer = { readonly server: Server; readonly url: string };

async function listen(server: Server): Promise<ListeningServer> {
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

function isCreatedObservation(status: number, body: unknown): body is Observation & { readonly id: string } {
  return (
    (status === 200 || status === 201) &&
    typeof body === 'object' &&
    body !== null &&
    'resourceType' in body &&
    body.resourceType === 'Observation' &&
    'id' in body &&
    typeof body.id === 'string'
  );
}

function isAccountApiResponse(value: unknown): value is AccountApiResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number' &&
    'body' in value
  );
}

function correlationHeaders(traceId: string): Record<string, string> {
  const spanId = randomUUID().replaceAll('-', '').slice(0, 16);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    'x-correlation-id': traceId,
  };
}
