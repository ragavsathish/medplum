// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, test } from 'vitest';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const openServers: Server[] = [];
const liveDispatcher = getGlobalDispatcher();
let mockAgent: MockAgent | undefined;

const measurementCases = [
  {
    name: 'height',
    measurement: {
      id: 'height-http-1',
      patientId: 'child-1',
      observedAt: '2026-09-14T08:00:00+03:00',
      kind: 'height',
      value: 138.2,
      unit: 'cm',
    },
  },
  {
    name: 'weight',
    measurement: {
      id: 'weight-http-1',
      patientId: 'child-1',
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
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  setGlobalDispatcher(liveDispatcher);
  await mockAgent?.close();
  mockAgent = undefined;
});

describe('Health Tracking HTTP API', () => {
  test.each(measurementCases)('records a $name measurement for the intended member over HTTP', async (testCase) => {
    await allure.story('DI-1');

    const medplum = await getMedplumTestBackend();
    await allure.parameter('Medplum backend', medplum.mode);

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
      body: testCase.measurement,
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

    const observationResponse = await fetch(
      new URL(`fhir/R4/Observation/${testCase.measurement.id}`, medplum.baseUrl),
      { headers: { authorization: `Bearer ${medplum.accessToken}` } }
    );
    const observationBody: unknown = await observationResponse.json();

    await allure.attachment(
      'HTTP API evidence',
      JSON.stringify(
        {
          medplumBackend: medplum.mode,
          request: apiRequest,
          response: { status: response.status, body: responseBody },
          persistedObservation: { status: observationResponse.status, body: observationBody },
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );

    expect(response.status).toBe(201);
    expect(responseBody).toEqual({ type: 'MEASUREMENT_RECORDED', payload: testCase.measurement });
    expect(observationResponse.status).toBe(200);
    expect(observationBody).toMatchObject({
      resourceType: 'Observation',
      id: testCase.measurement.id,
      subject: { reference: 'Patient/child-1' },
      effectiveDateTime: testCase.measurement.observedAt,
      valueQuantity: {
        value: testCase.measurement.value,
        unit: testCase.measurement.unit,
        system: 'http://unitsofmeasure.org',
        code: testCase.measurement.unit,
      },
    });
  });
});

async function getMedplumTestBackend(): Promise<MedplumTestBackend> {
  if (process.env['HEALTH_TRACKING_MEDPLUM_MODE'] === 'mock') {
    return createMockMedplumBackend();
  }

  return {
    mode: 'live',
    baseUrl: process.env['MEDPLUM_BASE_URL'] ?? 'http://127.0.0.1:8103/',
    accessToken: requiredEnvironmentVariable('MEDPLUM_ACCESS_TOKEN'),
  };
}

function createMockMedplumBackend(): MedplumTestBackend {
  const baseUrl = 'http://medplum.test/';
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

  return { mode: 'mock', baseUrl, accessToken: createTestAccessToken() };
}

const fhirResponse = { headers: { 'content-type': 'application/fhir+json' } } as const;

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
