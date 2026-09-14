// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const openServers: Server[] = [];

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
    const server = createMockMedplumServer();
    const { url } = await listen(server);
    return { mode: 'mock', baseUrl: url, accessToken: createTestAccessToken() };
  }

  return {
    mode: 'live',
    baseUrl: process.env['MEDPLUM_BASE_URL'] ?? 'http://127.0.0.1:8103/',
    accessToken: requiredEnvironmentVariable('MEDPLUM_ACCESS_TOKEN'),
  };
}

function createMockMedplumServer(): Server {
  const observations = new Map<string, unknown>();

  return createServer(async (request, response) => {
    const body = await readBody(request);

    if (request.method === 'GET' && request.url === '/auth/me') {
      return writeJson(response, 200, {
        profile: { resourceType: 'RelatedPerson', id: 'parent-1' },
      });
    }

    if (request.method === 'POST' && request.url === '/fhir/R4') {
      const observation = transactionResource(body, 'Observation');
      const id = typeof observation?.id === 'string' ? observation.id : undefined;
      if (id) {
        observations.set(id, observation);
      }
      return writeJson(response, 200, { resourceType: 'Bundle', type: 'transaction-response' });
    }

    const observationId = request.url?.match(/^\/fhir\/R4\/Observation\/([^/?]+)$/)?.[1];
    if (request.method === 'GET' && observationId && observations.has(observationId)) {
      return writeJson(response, 200, observations.get(observationId));
    }

    return writeJson(response, 404, { resourceType: 'OperationOutcome', issue: [] });
  });
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
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/fhir+json' });
  response.end(JSON.stringify(body));
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
