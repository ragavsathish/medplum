// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ClientStorage,
  getStatus,
  isGone,
  isNotFound,
  MedplumClient,
  MemoryStorage,
  normalizeOperationOutcome,
  resolveId,
} from '@medplum/core';
import type { Project } from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, test } from 'vitest';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const openServers: Server[] = [];
const fhirResourcesToDelete: FhirResourceFixture[] = [];
const liveDispatcher = getGlobalDispatcher();
let mockAgent: MockAgent | undefined;

const measurementCases = [
  {
    name: 'height',
    measurement: {
      observedAt: '2026-09-14T08:00:00+03:00',
      kind: 'height',
      value: 138.2,
      unit: 'cm',
    },
  },
  {
    name: 'weight',
    measurement: {
      observedAt: '2026-09-14T08:00:00+03:00',
      kind: 'weight',
      value: 32.4,
      unit: 'kg',
    },
  },
] as const;

type MedplumTestBackend = {
  readonly mode: 'live' | 'mock';
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly client: MedplumClient;
};

type AccessFixture = {
  readonly medplum: MedplumTestBackend;
  readonly patientId: string;
  readonly otherPatientId: string;
};

type FhirResourceFixture = {
  readonly client: MedplumClient;
  readonly resourceType: 'Observation' | 'Patient' | 'ProjectMembership' | 'RelatedPerson' | 'User';
  readonly id: string;
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  await cleanupFhirFixtures();
  setGlobalDispatcher(liveDispatcher);
  await mockAgent?.close();
  mockAgent = undefined;
});

describe('Health Tracking HTTP API', () => {
  test.each(measurementCases)('records a $name measurement for the intended member over HTTP', async (testCase) => {
    await allure.story('DI-1');

    const { medplum, patientId, otherPatientId } = await getAccessFixture();
    await allure.parameter('Medplum backend', medplum.mode);
    const actor = await medplum.client.getProfileAsync();
    if (!actor) {
      throw new Error('The acceptance user profile was not returned by Medplum');
    }
    const membership = medplum.client.getProjectMembership();
    const accessPolicy = medplum.client.getAccessPolicy();
    const [assignedPatientStatus, unassignedPatientStatus] = await Promise.all([
      readStatus(medplum.client, 'Patient', patientId),
      readStatus(medplum.client, 'Patient', otherPatientId),
    ]);
    await allure.attachment(
      'Access policy evidence',
      JSON.stringify(
        {
          actor: `${actor.resourceType}/${actor.id}`,
          actorIsAdmin: membership?.admin ?? false,
          resolvedAccessPolicy: accessPolicy,
          assignedPatient: `Patient/${patientId}`,
          assignedPatientReadStatus: assignedPatientStatus,
          unassignedPatientReadStatus: unassignedPatientStatus,
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );

    expect(actor.resourceType).toBe('RelatedPerson');
    expect(membership?.admin).not.toBe(true);
    expect(accessPolicy?.basedOn).toHaveLength(1);
    expect(accessPolicy?.resource).toContainEqual(
      expect.objectContaining({
        resourceType: 'Observation',
        criteria: `Observation?_compartment=Patient/${patientId}`,
      })
    );
    expect(assignedPatientStatus).toBe(200);
    expect(unassignedPatientStatus).toBe(404);

    const measurement = {
      id: `${testCase.name}-${randomUUID()}`,
      patientId,
      ...testCase.measurement,
    } as const;
    fhirResourcesToDelete.push({ client: medplum.client, resourceType: 'Observation', id: measurement.id });

    const healthTrackingServer = await listen(
      createServer(createHealthTrackingHttpApp({ medplumBaseUrl: medplum.baseUrl }))
    );
    const apiRequest = {
      method: 'POST',
      url: new URL('measurements', healthTrackingServer.url).toString(),
      headers: {
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      },
      body: measurement,
    } as const;

    const response = await fetch(apiRequest.url, {
      method: apiRequest.method,
      headers: {
        authorization: `Bearer ${medplum.accessToken}`,
        'content-type': apiRequest.headers['content-type'],
      },
      body: JSON.stringify(apiRequest.body),
    });
    const responseBody: unknown = await response.json();

    const observation = await medplum.client.readResource('Observation', measurement.id);

    await allure.attachment(
      'HTTP API evidence',
      JSON.stringify(
        {
          medplumBackend: medplum.mode,
          seededPatient: `Patient/${patientId}`,
          request: apiRequest,
          response: { status: response.status, body: responseBody },
          persistedObservation: observation,
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );

    expect(response.status).toBe(201);
    expect(responseBody).toEqual({ type: 'MEASUREMENT_RECORDED', payload: measurement });
    expect(observation).toMatchObject({
      resourceType: 'Observation',
      id: measurement.id,
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: measurement.observedAt,
      valueQuantity: {
        value: measurement.value,
        unit: measurement.unit,
        system: 'http://unitsofmeasure.org',
        code: measurement.unit,
      },
    });
  });
});

async function getAccessFixture(): Promise<AccessFixture> {
  if (process.env['HEALTH_TRACKING_MEDPLUM_MODE'] === 'mock') {
    return createMockAccessFixture();
  }

  return createLiveAccessFixture();
}

async function createLiveAccessFixture(): Promise<AccessFixture> {
  const baseUrl = process.env['MEDPLUM_BASE_URL'] ?? 'http://127.0.0.1:8103/';
  const admin = new MedplumClient({
    baseUrl,
    accessToken: requiredEnvironmentVariable('MEDPLUM_ADMIN_ACCESS_TOKEN'),
  });
  const adminProfile = await admin.getProfileAsync();
  if (!adminProfile || !admin.isSuperAdmin()) {
    throw new Error('MEDPLUM_ADMIN_ACCESS_TOKEN must identify the seeded human super administrator');
  }

  const project = await getOrCreateAcceptanceProject(admin);
  const patientId = await seedTestPatient(admin, project.id, 'Assigned');
  const otherPatientId = await seedTestPatient(admin, project.id, 'Unassigned');
  const email = `caregiver-${randomUUID()}@example.com`;
  const password = `Acceptance-${randomUUID()}!`;
  const membership = await admin.invite(project.id, {
    resourceType: 'RelatedPerson',
    firstName: 'Acceptance',
    lastName: 'Caregiver',
    email,
    password,
    patient: { reference: `Patient/${patientId}` },
    scope: 'project',
    sendEmail: false,
  });
  if (membership.resourceType !== 'ProjectMembership' || !membership.id || !membership.user || !membership.profile) {
    throw new Error('Failed to provision the RelatedPerson acceptance-test membership');
  }
  const userId = resolveId(membership.user);
  const profileId = resolveId(membership.profile);
  if (!userId || !profileId) {
    throw new Error('The RelatedPerson acceptance-test membership has invalid references');
  }
  fhirResourcesToDelete.push(
    { client: admin, resourceType: 'User', id: userId },
    { client: admin, resourceType: 'RelatedPerson', id: profileId },
    { client: admin, resourceType: 'ProjectMembership', id: membership.id }
  );

  const actorClient = await loginHumanUser(baseUrl, email, password, project.id);
  const accessToken = actorClient.getAccessToken();
  if (!accessToken) {
    throw new Error('The RelatedPerson acceptance-test login returned no access token');
  }
  return {
    medplum: createMedplumTestBackend({
      mode: 'live',
      baseUrl,
      accessToken,
      client: actorClient,
    }),
    patientId,
    otherPatientId,
  };
}

async function createMockAccessFixture(): Promise<AccessFixture> {
  const baseUrl = 'http://medplum.test/';
  const patients = new Map<string, unknown>();
  const observations = new Map<string, unknown>();
  let authorizedPatientId: string | undefined;
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  mockAgent.enableNetConnect(/^127\.0\.0\.1:\d+$/);
  setGlobalDispatcher(mockAgent);
  const medplum = mockAgent.get(new URL(baseUrl).origin);

  medplum
    .intercept({ method: 'GET', path: '/auth/me' })
    .reply(() => ({
      statusCode: 200,
      data: {
        project: { resourceType: 'Project', id: 'health-tracking-project', name: 'Health Tracking Acceptance' },
        membership: {
          resourceType: 'ProjectMembership',
          id: 'caregiver-membership',
          profile: { reference: 'RelatedPerson/parent-1' },
        },
        profile: {
          resourceType: 'RelatedPerson',
          id: 'parent-1',
          patient: { reference: `Patient/${authorizedPatientId}` },
        },
        config: { resourceType: 'UserConfiguration' },
        accessPolicy: {
          resourceType: 'AccessPolicy',
          basedOn: [{ reference: 'AccessPolicy/default-related-person' }],
          resource: [
            { resourceType: 'Patient', criteria: `Patient?_id=${authorizedPatientId}` },
            {
              resourceType: 'Observation',
              criteria: `Observation?_compartment=Patient/${authorizedPatientId}`,
            },
          ],
        },
      },
      responseOptions: fhirResponse,
    }))
    .persist();
  medplum
    .intercept({ method: 'POST', path: '/fhir/R4/Patient' })
    .reply(({ body }) => {
      const id = randomUUID();
      const patient = { ...asRecord(parseRequestBody(body)), id };
      patients.set(id, patient);
      authorizedPatientId ??= id;
      return { statusCode: 201, data: patient, responseOptions: fhirResponse };
    })
    .times(2);
  medplum
    .intercept({ method: 'GET', path: /^\/fhir\/R4\/Patient\/[^/?]+$/ })
    .reply(({ path }) => {
      const patientId = path.match(/^\/fhir\/R4\/Patient\/([^/?]+)$/)?.[1];
      const patient = patientId && patientId === authorizedPatientId ? patients.get(patientId) : undefined;
      return patient
        ? { statusCode: 200, data: patient, responseOptions: fhirResponse }
        : {
            statusCode: 404,
            data: { resourceType: 'OperationOutcome', id: 'not-found', issue: [] },
            responseOptions: fhirResponse,
          };
    })
    .persist();
  medplum
    .intercept({ method: 'POST', path: '/fhir/R4' })
    .reply(({ body }) => {
      const observation = transactionResource(parseRequestBody(body), 'Observation');
      const id = typeof observation?.id === 'string' ? observation.id : undefined;
      if (id) {
        observations.set(id, observation);
      }
      return {
        statusCode: 200,
        data: { resourceType: 'Bundle', type: 'transaction-response' },
        responseOptions: fhirResponse,
      };
    })
    .persist();
  medplum
    .intercept({ method: 'DELETE', path: /^\/fhir\/R4\/(Observation|Patient)\/[^/?]+$/ })
    .reply(({ path }) => {
      const [, resourceType, id] = path.match(/^\/fhir\/R4\/(Observation|Patient)\/([^/?]+)$/) ?? [];
      const deleted = resourceType === 'Observation' ? observations.delete(id) : patients.delete(id);
      return {
        statusCode: deleted ? 204 : 404,
        data: deleted ? undefined : { resourceType: 'OperationOutcome', id: 'not-found', issue: [] },
        responseOptions: fhirResponse,
      };
    })
    .persist();
  medplum
    .intercept({ method: 'GET', path: /^\/fhir\/R4\/Observation\/[^/?]+$/ })
    .reply(({ path }) => {
      const observationId = path.match(/^\/fhir\/R4\/Observation\/([^/?]+)$/)?.[1];
      const observation = observationId ? observations.get(observationId) : undefined;
      return observation
        ? { statusCode: 200, data: observation, responseOptions: fhirResponse }
        : {
            statusCode: 404,
            data: { resourceType: 'OperationOutcome', id: 'not-found', issue: [] },
            responseOptions: fhirResponse,
          };
    })
    .persist();

  const admin = new MedplumClient({ baseUrl, accessToken: createTestAccessToken('admin-login') });
  const patientId = await seedTestPatient(admin, undefined, 'Assigned');
  const otherPatientId = await seedTestPatient(admin, undefined, 'Unassigned');
  return {
    medplum: createMedplumTestBackend({
      mode: 'mock',
      baseUrl,
      accessToken: createTestAccessToken('caregiver-login'),
    }),
    patientId,
    otherPatientId,
  };
}

const fhirResponse = { headers: { 'content-type': 'application/fhir+json' } } as const;

async function getOrCreateAcceptanceProject(admin: MedplumClient): Promise<Project & { id: string }> {
  const name = 'Health Tracking Acceptance';
  const existing = await admin.searchOne('Project', { name });
  if (existing) {
    if (
      existing.superAdmin ||
      !existing.defaultAccessPolicies?.some((entry) => entry.profileType === 'RelatedPerson')
    ) {
      throw new Error('The Health Tracking Acceptance project is not initialized with RelatedPerson access');
    }
    return existing;
  }
  return admin.post<Project & { id: string }>('fhir/R4/Project/$init', {
    resourceType: 'Parameters',
    parameter: [{ name: 'name', valueString: name }],
  });
}

async function seedTestPatient(
  client: MedplumClient,
  projectId: string | undefined,
  given: 'Assigned' | 'Unassigned'
): Promise<string> {
  const patient = await client.createResource({
    resourceType: 'Patient',
    meta: projectId ? { project: projectId } : undefined,
    active: true,
    identifier: [{ system: 'urn:medplum:health-tracking:acceptance', value: randomUUID() }],
    name: [{ use: 'official', family: 'Acceptance', given: [given] }],
  });
  fhirResourcesToDelete.push({ client, resourceType: 'Patient', id: patient.id });
  return patient.id;
}

async function cleanupFhirFixtures(): Promise<void> {
  for (const fixture of fhirResourcesToDelete.splice(0).reverse()) {
    try {
      await fixture.client.deleteResource(fixture.resourceType, fixture.id);
    } catch (error) {
      const outcome = normalizeOperationOutcome(error);
      if (!isNotFound(outcome) && !isGone(outcome)) {
        throw error;
      }
    }
  }
}

function createMedplumTestBackend(
  backend: Omit<MedplumTestBackend, 'client'> & Partial<Pick<MedplumTestBackend, 'client'>>
): MedplumTestBackend {
  return {
    ...backend,
    client: backend.client ?? new MedplumClient({ baseUrl: backend.baseUrl, accessToken: backend.accessToken }),
  };
}

async function loginHumanUser(
  baseUrl: string,
  email: string,
  password: string,
  projectId: string
): Promise<MedplumClient> {
  const storage = new ClientStorage(new MemoryStorage());
  const codeVerifier = randomUUID();
  storage.setString('codeVerifier', codeVerifier);
  const client = new MedplumClient({ baseUrl, storage });
  let response = await client.startLogin({
    email,
    password,
    projectId,
    scope: 'openid profile',
    codeChallengeMethod: 'plain',
    codeChallenge: codeVerifier,
    redirectUri: 'http://localhost',
  });
  if (!response.code) {
    const membership = response.memberships?.find((item) => item.project?.reference === `Project/${projectId}`);
    if (!membership?.id) {
      throw new Error('The acceptance user has no membership in the Health Tracking Acceptance project');
    }
    response = await client.post('auth/profile', { login: response.login, profile: membership.id });
  }
  if (!response.code) {
    throw new Error('The acceptance user login returned no authorization code');
  }
  await client.processCode(response.code, { redirectUri: 'http://localhost' });
  await client.getProfileAsync();
  return client;
}

async function readStatus(client: MedplumClient, resourceType: 'Patient', id: string): Promise<number> {
  try {
    await client.readResource(resourceType, id, { cache: 'no-cache' });
    return 200;
  } catch (error) {
    return getStatus(normalizeOperationOutcome(error));
  }
}

async function listen(server: Server): Promise<{ server: Server; url: string }> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function parseRequestBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  if (body instanceof Uint8Array) {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  }
  return body;
}

function createTestAccessToken(loginId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ login_id: loginId, exp: Math.floor(Date.now() / 1000) + 300 })).toString(
    'base64url'
  );
  return `${header}.${payload}.test-signature`;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when testing against the Docker Compose Medplum server`);
  }
  return value;
}

function transactionResource(value: unknown, resourceType: string): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.entry)) {
    return undefined;
  }

  for (const entry of value.entry) {
    const resource = isRecord(entry) && isRecord(entry.resource) ? entry.resource : undefined;
    if (resource?.resourceType === resourceType) {
      return resource;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
