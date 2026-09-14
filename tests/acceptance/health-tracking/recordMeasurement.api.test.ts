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
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import type { Measurement } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/core/entities/measurement';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const openServers: Server[] = [];
const fhirResourcesToDelete: FhirResourceFixture[] = [];
let mockServer: ReturnType<typeof setupServer> | undefined;

const measurementCases = [
  {
    acceptanceCriterion: 'AC-HT-001',
    name: 'height',
    loincCode: '8302-2',
    measurement: {
      observedAt: '2026-09-14T08:00:00+03:00',
      kind: 'height',
      value: 138.2,
      unit: 'cm',
    },
  },
  {
    acceptanceCriterion: 'AC-HT-002',
    name: 'weight',
    loincCode: '29463-7',
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
  readonly cleanupClient: MedplumClient;
  readonly patientId: string;
  readonly otherPatientId: string;
};

type MockTransactionOutcome = 'success' | 'invalid' | 'rate-limited' | 'unavailable' | 'unconfirmed';

type HttpTestResult = {
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly headers: {
      readonly authorization: string;
      readonly 'content-type': 'application/json';
    };
    readonly body: unknown;
  };
  readonly response: Response;
  readonly responseBody: unknown;
};

type FhirResourceFixture = {
  readonly client: MedplumClient;
  readonly resourceType: 'Observation' | 'Patient' | 'ProjectMembership' | 'Provenance' | 'RelatedPerson' | 'User';
  readonly id: string;
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  await cleanupFhirFixtures();
  mockServer?.close();
  mockServer = undefined;
});

describe('Health Tracking HTTP API', () => {
  test.each(measurementCases)('records a $name measurement for the intended member over HTTP', async (testCase) => {
    await allure.story(testCase.acceptanceCriterion);

    const { medplum, cleanupClient, patientId, otherPatientId } = await getAccessFixture();
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
    fhirResourcesToDelete.push({ client: cleanupClient, resourceType: 'Observation', id: measurement.id });

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
    const provenances = await medplum.client.searchResources('Provenance', {
      target: `Observation/${measurement.id}`,
    });
    expect(provenances).toHaveLength(1);
    const provenance = provenances[0];
    if (!provenance?.id) {
      throw new Error('The recorder Provenance was not committed with the Observation');
    }
    fhirResourcesToDelete.push({ client: cleanupClient, resourceType: 'Provenance', id: provenance.id });

    await allure.attachment(
      'HTTP API evidence',
      JSON.stringify(
        {
          medplumBackend: medplum.mode,
          seededPatient: `Patient/${patientId}`,
          request: apiRequest,
          response: { status: response.status, body: responseBody },
          persistedObservation: observation,
          persistedProvenance: provenance,
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
      code: {
        coding: expect.arrayContaining([
          expect.objectContaining({ system: 'http://loinc.org', code: testCase.loincCode }),
        ]),
      },
      effectiveDateTime: measurement.observedAt,
      valueQuantity: {
        value: measurement.value,
        unit: measurement.unit,
        system: 'http://unitsofmeasure.org',
        code: measurement.unit,
      },
    });
    expect(provenance).toMatchObject({
      target: expect.arrayContaining([{ reference: `Observation/${measurement.id}` }]),
      occurredDateTime: measurement.observedAt,
      agent: expect.arrayContaining([
        expect.objectContaining({ who: { reference: `${actor.resourceType}/${actor.id}` } }),
      ]),
    });
  });

  test('rejects an invalid measurement without reporting it as recorded', async () => {
    await allure.story('AC-HT-003');
    const { medplum, patientId } = await createMockAccessFixture();

    const result = await postMeasurement(medplum, {
      ...validWeightMeasurement(patientId),
      value: 0,
    });
    await attachHttpEvidence('Invalid measurement evidence', result);

    expect(result.response.status).toBe(400);
    expect(result.responseBody).toEqual({
      type: 'MEASUREMENT_REJECTED',
      payload: { reason: 'INVALID_MEASUREMENT' },
    });
  });

  test('rejects a measurement for a member outside the recorder access policy', async () => {
    await allure.story('AC-HT-003');
    const { medplum, otherPatientId } = await createMockAccessFixture();

    const result = await postMeasurement(medplum, validWeightMeasurement(otherPatientId));
    await attachHttpEvidence('Not permitted evidence', result);

    expect(result.response.status).toBe(403);
    expect(result.responseBody).toEqual({
      type: 'MEASUREMENT_REJECTED',
      payload: { reason: 'NOT_PERMITTED' },
    });
  });

  test('translates Medplum FHIR validation refusal into a rejected measurement', async () => {
    await allure.story('AC-HT-003');
    const { medplum, patientId } = await createMockAccessFixture('invalid');

    const result = await postMeasurement(medplum, validWeightMeasurement(patientId));
    await attachHttpEvidence('FHIR validation evidence', result);

    expect(result.response.status).toBe(400);
    expect(result.responseBody).toEqual({
      type: 'MEASUREMENT_REJECTED',
      payload: { reason: 'INVALID_MEASUREMENT' },
    });
  });

  test.each([
    { medplumStatus: 429, outcome: 'rate-limited' },
    { medplumStatus: 500, outcome: 'unavailable' },
  ] as const)('reports a known Medplum $medplumStatus failure without reporting a commit', async (testCase) => {
    await allure.story('AC-HT-003');
    const { medplum, patientId } = await createMockAccessFixture(testCase.outcome);

    const result = await postMeasurement(medplum, validWeightMeasurement(patientId));
    await attachHttpEvidence(`Medplum ${testCase.medplumStatus} evidence`, result);

    expect(result.response.status).toBe(503);
    expect(result.responseBody).toEqual({
      type: 'MEASUREMENT_RECORDING_FAILED',
      payload: { reason: 'RECORD_UNAVAILABLE' },
    });
  });

  test('reports an unconfirmed outcome when the Medplum transaction response is lost', async () => {
    await allure.story('AC-HT-003');
    const { medplum, patientId } = await createMockAccessFixture('unconfirmed');

    const result = await postMeasurement(medplum, validWeightMeasurement(patientId));
    await attachHttpEvidence('Unconfirmed transaction evidence', result);

    expect(result.response.status).toBe(503);
    expect(result.responseBody).toEqual({
      type: 'MEASUREMENT_RECORDING_UNCONFIRMED',
      payload: { reason: 'OUTCOME_UNKNOWN' },
    });
  });

  test.each([
    { authentication: 'missing', bearerToken: null },
    { authentication: 'invalid', bearerToken: 'invalid-token' },
  ])('rejects a $authentication bearer token before recording a measurement', async (testCase) => {
    await allure.story('DI-1 authentication boundary');
    const { medplum, patientId } = await createMockAccessFixture();

    const result = await postMeasurement(medplum, validWeightMeasurement(patientId), testCase.bearerToken);
    await attachHttpEvidence(`${testCase.authentication} bearer token evidence`, result);

    expect(result.response.status).toBe(401);
    expect(result.responseBody).toMatchObject({ resourceType: 'OperationOutcome' });
  });
});

const validWeightMeasurement = (patientId: string): Measurement => {
  return {
    id: `weight-${randomUUID()}`,
    patientId,
    observedAt: '2026-09-14T08:00:00+03:00',
    kind: 'weight',
    value: 32.4,
    unit: 'kg',
  } as const;
};

const postMeasurement = async (
  medplum: MedplumTestBackend,
  body: unknown,
  bearerToken: string | null = medplum.accessToken
): Promise<HttpTestResult> => {
  const healthTrackingServer = await listen(
    createServer(createHealthTrackingHttpApp({ medplumBaseUrl: medplum.baseUrl }))
  );
  const request = {
    method: 'POST',
    url: new URL('measurements', healthTrackingServer.url).toString(),
    headers: {
      authorization: bearerToken ? '[REDACTED]' : '[ABSENT]',
      'content-type': 'application/json',
    },
    body,
  } as const;
  const headers: Record<string, string> = { 'content-type': request.headers['content-type'] };
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  const response = await fetch(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(request.body),
  });
  const responseBody: unknown = await response.json();
  return { request, response, responseBody };
};

async function attachHttpEvidence(title: string, result: Awaited<ReturnType<typeof postMeasurement>>): Promise<void> {
  await allure.attachment(
    title,
    JSON.stringify(
      {
        request: result.request,
        response: { status: result.response.status, body: result.responseBody },
      },
      null,
      2
    ),
    { contentType: 'application/json' }
  );
}

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
    cleanupClient: admin,
    patientId,
    otherPatientId,
  };
}

async function createMockAccessFixture(transactionOutcome: MockTransactionOutcome = 'success'): Promise<AccessFixture> {
  const baseUrl = 'http://medplum.test/';
  const actorAccessToken = createTestAccessToken('caregiver-login');
  const patients = new Map<string, unknown>();
  const observations = new Map<string, unknown>();
  const provenances = new Map<string, unknown>();
  let authorizedPatientId: string | undefined;
  mockServer = setupServer(
    http.get(`${baseUrl}auth/me`, ({ request }) => {
      if (request.headers.get('authorization') !== `Bearer ${actorAccessToken}`) {
        return fhirOutcome(401, 'login');
      }
      return HttpResponse.json(
        {
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
              {
                resourceType: 'Provenance',
                criteria: `Provenance?_compartment=Patient/${authorizedPatientId}`,
              },
            ],
          },
        },
        { headers: fhirHeaders }
      );
    }),
    http.post(`${baseUrl}fhir/R4/Patient`, async ({ request }) => {
      const id = randomUUID();
      const patient = { ...asRecord(await request.json()), id };
      patients.set(id, patient);
      authorizedPatientId ??= id;
      return HttpResponse.json(patient, { status: 201, headers: fhirHeaders });
    }),
    http.get(`${baseUrl}fhir/R4/Patient/:id`, ({ params }) => {
      const patientId = String(params['id']);
      const patient = patientId && patientId === authorizedPatientId ? patients.get(patientId) : undefined;
      return patient ? HttpResponse.json(patient, { headers: fhirHeaders }) : fhirOutcome(404, 'not-found');
    }),
    http.post(`${baseUrl}fhir/R4`, async ({ request }) => {
      if (transactionOutcome === 'unconfirmed') {
        return HttpResponse.error();
      }
      if (transactionOutcome === 'invalid') {
        return fhirOutcome(400, 'invalid');
      }
      if (transactionOutcome === 'rate-limited') {
        return fhirOutcome(429, 'throttled');
      }
      if (transactionOutcome === 'unavailable') {
        return fhirOutcome(500, 'transient');
      }

      const body: unknown = await request.json();
      const observation = transactionResource(body, 'Observation');
      const subject = isRecord(observation?.subject) ? observation.subject.reference : undefined;
      if (subject !== `Patient/${authorizedPatientId}`) {
        return fhirOutcome(403, 'forbidden');
      }
      const observationId = typeof observation?.id === 'string' ? observation.id : undefined;
      if (observationId) {
        observations.set(observationId, observation);
      }
      const provenance = transactionResource(body, 'Provenance');
      const provenanceId = typeof provenance?.id === 'string' ? provenance.id : undefined;
      if (provenanceId) {
        provenances.set(provenanceId, provenance);
      }
      return HttpResponse.json({ resourceType: 'Bundle', type: 'transaction-response' }, { headers: fhirHeaders });
    }),
    http.delete(`${baseUrl}fhir/R4/:resourceType/:id`, ({ params }) => {
      const resourceType = String(params['resourceType']);
      const id = String(params['id']);
      let deleted: boolean;
      if (resourceType === 'Observation') {
        deleted = observations.delete(id);
      } else if (resourceType === 'Provenance') {
        deleted = provenances.delete(id);
      } else {
        deleted = patients.delete(id);
      }
      return deleted ? new HttpResponse(null, { status: 204, headers: fhirHeaders }) : fhirOutcome(404, 'not-found');
    }),
    http.get(`${baseUrl}fhir/R4/Provenance`, ({ request }) => {
      const target = new URL(request.url).searchParams.get('target');
      const matches = [...provenances.values()].filter(
        (resource) =>
          isRecord(resource) &&
          Array.isArray(resource.target) &&
          resource.target.some((reference) => isRecord(reference) && reference.reference === target)
      );
      return HttpResponse.json(
        {
          resourceType: 'Bundle',
          type: 'searchset',
          total: matches.length,
          entry: matches.map((resource) => ({ resource })),
        },
        { headers: fhirHeaders }
      );
    }),
    http.get(`${baseUrl}fhir/R4/Observation/:id`, ({ params }) => {
      const observationId = String(params['id']);
      const observation = observationId ? observations.get(observationId) : undefined;
      return observation ? HttpResponse.json(observation, { headers: fhirHeaders }) : fhirOutcome(404, 'not-found');
    })
  );
  mockServer.listen({ onUnhandledRequest: 'bypass' });

  const admin = new MedplumClient({ baseUrl, accessToken: createTestAccessToken('admin-login') });
  const patientId = await seedTestPatient(admin, undefined, 'Assigned');
  const otherPatientId = await seedTestPatient(admin, undefined, 'Unassigned');
  return {
    medplum: createMedplumTestBackend({
      mode: 'mock',
      baseUrl,
      accessToken: actorAccessToken,
    }),
    cleanupClient: admin,
    patientId,
    otherPatientId,
  };
}

const fhirHeaders = { 'content-type': 'application/fhir+json' } as const;

const fhirOutcome = (status: number, code: string): HttpResponse<object> =>
  HttpResponse.json(
    { resourceType: 'OperationOutcome', id: code, issue: [{ severity: 'error', code }] },
    { status, headers: fhirHeaders }
  );

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
