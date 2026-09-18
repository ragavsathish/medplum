// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { badRequest, conflict, forbidden, serverTimeout, tooManyRequests, unauthorized } from '@medplum/core';
import * as allure from 'allure-js-commons';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { MEASUREMENT_IDENTIFIER_SYSTEM } from '../../../src/contexts/health-tracking/infra/fhir/measurementObservations';
import { createHealthTrackingHttpApp } from '../../../src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const medplumBaseUrl = 'http://medplum.test/';
const accessToken = createTestAccessToken();
const openServers: Server[] = [];
const medplum = setupServer();

const height = {
  id: '10000000-0000-4000-8000-000000000001',
  patientId: '20000000-0000-4000-8000-000000000001',
  observedAt: '2026-09-14T08:00:00+03:00',
  kind: 'height',
  value: 138.2,
  unit: 'cm',
} as const;
const weight = {
  id: '10000000-0000-4000-8000-000000000002',
  patientId: '20000000-0000-4000-8000-000000000001',
  observedAt: '2026-09-14T08:00:00+03:00',
  kind: 'weight',
  value: 32.4,
  unit: 'kg',
} as const;

type CapturedRequest = { method: string; url: string; authorization?: string; body?: unknown };

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

describe('Health Tracking HTTP API — baseline acceptance', () => {
  test.each([
    { name: 'height', measurement: height, profile: 'http://hl7.org/fhir/StructureDefinition/bodyheight' },
    { name: 'weight', measurement: weight, profile: 'http://hl7.org/fhir/StructureDefinition/bodyweight' },
  ] as const)('records a $name measurement for the intended member', async ({ measurement, profile }) => {
    await traceTo('AC-HT-001', 'AC-HT-002', 'AC-HT-003');
    const captured: CapturedRequest[] = [];
    useAuthenticatedActor(captured);
    medplum.use(
      http.post(`${medplumBaseUrl}fhir/R4`, async ({ request }) => {
        captured.push(await capture(request));
        return HttpResponse.json({ resourceType: 'Bundle', type: 'transaction-response' });
      })
    );

    const result = await postMeasurement(measurement);
    await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: captured });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ type: 'MEASUREMENT_RECORDED', payload: measurement });
    expect(captured).toHaveLength(2);
    expect(captured.every((request) => request.authorization === '[REDACTED]')).toBe(true);
    expect(transactionResource(captured[1]?.body, 'Observation')).toMatchObject({
      resourceType: 'Observation',
      identifier: [{ system: MEASUREMENT_IDENTIFIER_SYSTEM, value: measurement.id }],
      meta: { profile: [profile] },
      subject: { reference: 'Patient/20000000-0000-4000-8000-000000000001' },
      effectiveDateTime: measurement.observedAt,
      valueQuantity: {
        value: measurement.value,
        unit: measurement.unit,
        system: 'http://unitsofmeasure.org',
        code: measurement.unit,
      },
    });
    expect(transactionResource(captured[1]?.body, 'Provenance')).toMatchObject({
      resourceType: 'Provenance',
      target: [{ reference: `urn:uuid:${measurement.id}` }],
      occurredDateTime: measurement.observedAt,
      agent: [{ who: { reference: 'RelatedPerson/parent-1' } }],
    });
    expect(transactionEntry(captured[1]?.body, 'Observation')).toMatchObject({
      fullUrl: `urn:uuid:${measurement.id}`,
      request: { method: 'POST', url: 'Observation' },
    });
  });
});

describe('Health Tracking HTTP API — failure outcomes', () => {
  test('returns 401 when the bearer token is missing', async () => {
    await traceDesignScenario('AUTHENTICATION_REQUIRED');
    const result = await postMeasurement(weight, null);
    await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: [] });
    expect(result).toMatchObject({ status: 401, body: unauthorized });
  });

  test('returns 401 when the authorization scheme is not Bearer', async () => {
    await traceDesignScenario('AUTHENTICATION_REQUIRED');
    const result = await postMeasurement(weight, 'Basic test-credentials');
    await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: [] });
    expect(result).toMatchObject({ status: 401, body: unauthorized });
  });

  test('returns 400 when the HTTP body is not valid JSON', async () => {
    await traceDesignScenario('INVALID_JSON');
    const result = await postRawMeasurement('{not-json');
    await attachEvidence({ mode: 'http-transport', ...result });
    expect(result).toMatchObject({ status: 400, body: { code: 'INVALID_JSON' } });
  });

  test('passes through an unauthorized current-actor response', async () => {
    await traceDesignScenario('ACTOR_UNAVAILABLE');
    medplum.use(http.get(`${medplumBaseUrl}auth/me`, () => HttpResponse.json(unauthorized, { status: 401 })));
    const result = await postMeasurement(weight);
    await attachEvidence({ mode: 'intercepted-medplum', ...result });
    expect(result).toMatchObject({ status: 401, body: unauthorized });
  });

  test.each([
    { name: 'non-positive value', measurement: { ...weight, value: 0 } },
    { name: 'invalid measurement ID', measurement: { ...weight, id: 'not-a-uuid' } },
    { name: 'invalid member ID', measurement: { ...weight, patientId: 'not-a-uuid' } },
  ])('returns 400 without persistence for $name', async ({ measurement }) => {
    await traceDesignScenario('INVALID_MEASUREMENT');
    const captured: CapturedRequest[] = [];
    useAuthenticatedActor(captured);
    const result = await postMeasurement(measurement);
    await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: captured });
    expect(result).toMatchObject({
      status: 400,
      body: { type: 'MEASUREMENT_REJECTED', payload: { reason: 'INVALID_MEASUREMENT' } },
    });
    expect(captured).toHaveLength(1);
  });

  test.each([
    {
      name: 'authorization denial',
      medplumStatus: 403,
      medplumOutcome: forbidden,
      expectedStatus: 403,
      expectedBody: forbidden,
      scenario: 'NOT_PERMITTED',
    },
    {
      name: 'FHIR validation rejection',
      medplumStatus: 400,
      medplumOutcome: badRequest('Invalid Observation'),
      expectedStatus: 400,
      expectedBody: { type: 'MEASUREMENT_REJECTED', payload: { reason: 'INVALID_MEASUREMENT' } },
      scenario: 'FHIR_VALIDATION_REJECTED',
    },
    {
      name: 'rate limiting',
      medplumStatus: 429,
      medplumOutcome: tooManyRequests,
      expectedStatus: 503,
      expectedBody: { type: 'MEASUREMENT_RECORDING_FAILED', payload: { reason: 'RECORD_UNAVAILABLE' } },
      scenario: 'RECORD_UNAVAILABLE',
    },
    {
      name: 'server failure',
      medplumStatus: 504,
      medplumOutcome: serverTimeout(),
      expectedStatus: 503,
      expectedBody: { type: 'MEASUREMENT_RECORDING_FAILED', payload: { reason: 'RECORD_UNAVAILABLE' } },
      scenario: 'RECORD_UNAVAILABLE',
    },
    {
      name: 'other FHIR outcome',
      medplumStatus: 409,
      medplumOutcome: conflict('Version conflict'),
      expectedStatus: 409,
      expectedBody: conflict('Version conflict'),
      scenario: 'FHIR_OUTCOME_PASSTHROUGH',
    },
  ] as const)(
    'maps $name to the documented HTTP outcome',
    async ({ medplumStatus, medplumOutcome, expectedStatus, expectedBody, scenario }) => {
      await traceDesignScenario(scenario);
      const captured: CapturedRequest[] = [];
      useAuthenticatedActor(captured);
      medplum.use(
        http.post(`${medplumBaseUrl}fhir/R4`, async ({ request }) => {
          captured.push(await capture(request));
          return HttpResponse.json(medplumOutcome, { status: medplumStatus });
        })
      );
      const result = await postMeasurement(weight);
      await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: captured });
      expect(result.status).toBe(expectedStatus);
      expect(result.body).toEqual(expectedBody);
    }
  );

  test('returns an unconfirmed outcome when the Medplum response is lost', async () => {
    await traceDesignScenario('OUTCOME_UNKNOWN');
    const captured: CapturedRequest[] = [];
    useAuthenticatedActor(captured);
    medplum.use(
      http.post(`${medplumBaseUrl}fhir/R4`, async ({ request }) => {
        captured.push(await capture(request));
        return HttpResponse.error();
      })
    );
    const result = await postMeasurement(weight);
    await attachEvidence({ mode: 'intercepted-medplum', ...result, medplumRequests: captured });
    expect(result).toMatchObject({
      status: 503,
      body: { type: 'MEASUREMENT_RECORDING_UNCONFIRMED', payload: { reason: 'OUTCOME_UNKNOWN' } },
    });
  });
});

function useAuthenticatedActor(captured: CapturedRequest[]): void {
  medplum.use(
    http.get(`${medplumBaseUrl}auth/me`, async ({ request }) => {
      captured.push(await capture(request));
      return HttpResponse.json({ profile: { resourceType: 'RelatedPerson', id: 'parent-1' } });
    })
  );
}

async function postMeasurement(
  body: unknown,
  authorization: string | null = `Bearer ${accessToken}`
): Promise<{ request: Record<string, unknown>; status: number; body: unknown }> {
  const healthTrackingServer = await listen(createServer(createHealthTrackingHttpApp({ medplumBaseUrl })));
  const request = {
    method: 'POST',
    url: `${healthTrackingServer.url}measurements`,
    headers: { ...(authorization ? { authorization: '[REDACTED]' } : {}), 'content-type': 'application/json' },
    body,
  };
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { request, status: response.status, body: await response.json() };
}

async function postRawMeasurement(
  body: string
): Promise<{ request: Record<string, unknown>; status: number; body: unknown }> {
  const healthTrackingServer = await listen(createServer(createHealthTrackingHttpApp({ medplumBaseUrl })));
  const request = {
    method: 'POST',
    url: `${healthTrackingServer.url}measurements`,
    headers: { authorization: '[REDACTED]', 'content-type': 'application/json' },
    body,
  };
  const response = await fetch(request.url, {
    method: request.method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body,
  });
  return { request, status: response.status, body: await response.json() };
}

async function capture(request: Request): Promise<CapturedRequest> {
  const text = await request.text();
  return {
    method: request.method,
    url: new URL(request.url).pathname,
    authorization: request.headers.has('authorization') ? '[REDACTED]' : undefined,
    body: text ? JSON.parse(text) : undefined,
  };
}

async function attachEvidence(evidence: unknown): Promise<void> {
  await allure.attachment('HTTP API evidence', JSON.stringify(evidence, null, 2), { contentType: 'application/json' });
}

async function traceTo(...acceptanceCriteria: string[]): Promise<void> {
  await allure.epic('UN-HT-001');
  await allure.feature('DI-1');
  await Promise.all(acceptanceCriteria.map((id) => allure.label('acceptanceCriterion', id)));
}

async function traceDesignScenario(scenario: string): Promise<void> {
  await allure.epic('UN-HT-001');
  await allure.feature('DI-1');
  await allure.label('designScenario', scenario);
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

function createTestAccessToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ login_id: 'acceptance-login', exp: Math.floor(Date.now() / 1000) + 300 })
  ).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function transactionResource(value: unknown, resourceType: string): Record<string, unknown> | undefined {
  const entry = transactionEntry(value, resourceType);
  return entry && isRecord(entry.resource) ? entry.resource : undefined;
}

function transactionEntry(value: unknown, resourceType: string): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.entry)) {
    return undefined;
  }
  for (const entry of value.entry) {
    const resource = isRecord(entry) && isRecord(entry.resource) ? entry.resource : undefined;
    if (resource?.resourceType === resourceType) {
      return entry;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
