// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { isGone, isNotFound, MedplumClient, normalizeOperationOutcome } from '@medplum/core';
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

type FhirResourceFixture = {
  readonly medplum: MedplumTestBackend;
  readonly resourceType: 'Observation' | 'Patient';
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

    const medplum = await getMedplumTestBackend();
    await allure.parameter('Medplum backend', medplum.mode);
    const patientId = await seedTestPatient(medplum);
    const measurement = {
      id: `${testCase.name}-${randomUUID()}`,
      patientId,
      ...testCase.measurement,
    } as const;
    fhirResourcesToDelete.push({ medplum, resourceType: 'Observation', id: measurement.id });

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

async function getMedplumTestBackend(): Promise<MedplumTestBackend> {
  if (process.env['HEALTH_TRACKING_MEDPLUM_MODE'] === 'mock') {
    return createMockMedplumBackend();
  }

  return createMedplumTestBackend({
    mode: 'live',
    baseUrl: process.env['MEDPLUM_BASE_URL'] ?? 'http://127.0.0.1:8103/',
    accessToken: requiredEnvironmentVariable('MEDPLUM_ACCESS_TOKEN'),
  });
}

function createMockMedplumBackend(): MedplumTestBackend {
  const baseUrl = 'http://medplum.test/';
  const patients = new Map<string, unknown>();
  const observations = new Map<string, unknown>();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  mockAgent.enableNetConnect(/^127\.0\.0\.1:\d+$/);
  setGlobalDispatcher(mockAgent);
  const medplum = mockAgent.get(baseUrl);

  medplum
    .intercept({ method: 'GET', path: '/auth/me' })
    .reply(200, { profile: { resourceType: 'RelatedPerson', id: 'parent-1' } }, fhirResponse)
    .persist();
  medplum
    .intercept({ method: 'POST', path: '/fhir/R4/Patient' })
    .reply(({ body }) => {
      const id = randomUUID();
      const patient = { ...asRecord(parseRequestBody(body)), id };
      patients.set(id, patient);
      return { statusCode: 201, data: patient, responseOptions: fhirResponse };
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
        data: deleted ? undefined : { resourceType: 'OperationOutcome', issue: [] },
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
            data: { resourceType: 'OperationOutcome', issue: [] },
            responseOptions: fhirResponse,
          };
    })
    .persist();

  return createMedplumTestBackend({ mode: 'mock', baseUrl, accessToken: createTestAccessToken() });
}

const fhirResponse = { headers: { 'content-type': 'application/fhir+json' } } as const;

async function seedTestPatient(medplum: MedplumTestBackend): Promise<string> {
  const patient = await medplum.client.createResource({
    resourceType: 'Patient',
    active: true,
    identifier: [{ system: 'urn:medplum:health-tracking:acceptance', value: randomUUID() }],
    name: [{ use: 'official', family: 'Acceptance', given: ['Health Tracking'] }],
  });
  fhirResourcesToDelete.push({ medplum, resourceType: 'Patient', id: patient.id });
  return patient.id;
}

async function cleanupFhirFixtures(): Promise<void> {
  for (const fixture of fhirResourcesToDelete.splice(0).reverse()) {
    try {
      await fixture.medplum.client.deleteResource(fixture.resourceType, fixture.id);
    } catch (error) {
      const outcome = normalizeOperationOutcome(error);
      if (!isNotFound(outcome) && !isGone(outcome)) {
        throw error;
      }
    }
  }
}

function createMedplumTestBackend(backend: Omit<MedplumTestBackend, 'client'>): MedplumTestBackend {
  return { ...backend, client: new MedplumClient({ baseUrl: backend.baseUrl, accessToken: backend.accessToken }) };
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

function createTestAccessToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ login_id: 'acceptance-login', exp: Math.floor(Date.now() / 1000) + 300 })
  ).toString('base64url');
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
