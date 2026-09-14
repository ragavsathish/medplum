// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const openServers: Server[] = [];
const accessToken = createTestAccessToken();

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
    unitCode: 'cm',
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
    unitCode: 'kg',
  },
] as const;

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
};

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

describe('Health Tracking HTTP API', () => {
  test.each(measurementCases)('records a $name measurement for the intended member over HTTP', async (testCase) => {
    await allure.story('DI-1');

    const medplumRequests: CapturedRequest[] = [];
    const medplumServer = await listen(createFakeMedplumServer(medplumRequests));
    const healthTrackingServer = await listen(
      createServer(createHealthTrackingHttpApp({ medplumBaseUrl: medplumServer.url }))
    );

    const apiRequest = {
      method: 'POST',
      url: `${healthTrackingServer.url}measurements`,
      headers: {
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      },
      body: testCase.measurement,
    } as const;

    const response = await fetch(apiRequest.url, {
      method: apiRequest.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': apiRequest.headers['content-type'],
      },
      body: JSON.stringify(apiRequest.body),
    });
    const responseBody: unknown = await response.json();

    await allure.attachment(
      'HTTP API evidence',
      JSON.stringify(
        {
          request: apiRequest,
          response: { status: response.status, body: responseBody },
          medplumRequests: medplumRequests.map(redactAuthorization),
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );

    expect(response.status).toBe(201);
    expect(responseBody).toEqual({ type: 'MEASUREMENT_RECORDED', payload: testCase.measurement });
    expect(medplumRequests.length).toBe(2);
    expect(medplumRequests[1]?.authorization === `Bearer ${accessToken}`).toBe(true);
    const transaction = recordValue(medplumRequests[1]?.body);
    expect({
      method: medplumRequests[1]?.method,
      url: medplumRequests[1]?.url,
      resourceType: transaction?.resourceType,
      type: transaction?.type,
      observation: transactionResource(transaction, 'Observation'),
    }).toMatchObject({
      method: 'POST',
      url: '/fhir/R4',
      resourceType: 'Bundle',
      type: 'transaction',
      observation: {
        resourceType: 'Observation',
        id: testCase.measurement.id,
        subject: { reference: 'Patient/child-1' },
        effectiveDateTime: testCase.measurement.observedAt,
        valueQuantity: {
          value: testCase.measurement.value,
          unit: testCase.measurement.unit,
          system: 'http://unitsofmeasure.org',
          code: testCase.unitCode,
        },
      },
    });
  });
});

function createFakeMedplumServer(requests: CapturedRequest[]): Server {
  return createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: singleHeader(request.headers.authorization),
      body,
    });

    if (request.method === 'GET' && request.url === '/auth/me') {
      return writeJson(response, 200, {
        profile: { resourceType: 'RelatedPerson', id: 'parent-1' },
      });
    }

    if (request.method === 'POST' && request.url === '/fhir/R4') {
      return writeJson(response, 200, { resourceType: 'Bundle', type: 'transaction-response' });
    }

    return writeJson(response, 404, { error: 'Unexpected fake Medplum request' });
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

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function redactAuthorization(request: CapturedRequest): CapturedRequest {
  return { ...request, authorization: request.authorization ? '[REDACTED]' : undefined };
}

function createTestAccessToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ login_id: 'acceptance-login', exp: Math.floor(Date.now() / 1000) + 300 })
  ).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function transactionResource(
  transaction: Record<string, unknown> | undefined,
  resourceType: string
): Record<string, unknown> | undefined {
  if (!Array.isArray(transaction?.entry)) {
    return undefined;
  }

  for (const value of transaction.entry) {
    const resource = recordValue(recordValue(value)?.resource);
    if (resource?.resourceType === resourceType) {
      return resource;
    }
  }

  return undefined;
}
