// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { LoginAuthenticationResponse } from '@medplum/core';
import { MedplumClient } from '@medplum/core';
import type { Patient, Provenance, ResourceType } from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MEASUREMENT_IDENTIFIER_SYSTEM } from '../../../src/contexts/health-tracking/infra/fhir/measurementObservations';
import { createHealthTrackingHttpApp } from '../../../src/contexts/health-tracking/infra/http/healthTrackingHttpApp';
import { createAccountAcceptanceFixture } from '../accounts/support/accountAcceptanceFixture';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const medplumBaseUrl = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const executeFile = promisify(execFile);
let healthTrackingServer: Server | undefined;
let healthTrackingUrl: string;
let digitizationBotHealthTrackingUrl: string;
let medplum: MedplumClient;
let dockerEvidenceSince: string;
const createdResources: { client: MedplumClient; resourceType: ResourceType; id: string }[] = [];

describe.skipIf(!runAcceptance)('Health Tracking HTTP API — full-stack Medplum', () => {
  beforeAll(async () => {
    dockerEvidenceSince = new Date(Date.now() - 1_000).toISOString();
    medplum = await loginToDockerMedplum();
    const listening = await listen(createServer(createHealthTrackingHttpApp({ medplumBaseUrl })), '0.0.0.0');
    healthTrackingServer = listening.server;
    healthTrackingUrl = listening.url;
    digitizationBotHealthTrackingUrl = `http://host.docker.internal:${listening.port}/measurements`;
  }, 30_000);

  afterAll(async () => {
    await closeServer(healthTrackingServer);
    const deletionPriority: Partial<Record<ResourceType, number>> = {
      ProjectMembership: 0,
      Provenance: 1,
      Observation: 2,
      Patient: 3,
      Practitioner: 4,
      AccessPolicy: 5,
    };
    createdResources.sort(
      (left, right) => (deletionPriority[left.resourceType] ?? 10) - (deletionPriority[right.resourceType] ?? 10)
    );
    for (const resource of createdResources) {
      await resource.client.deleteResource(resource.resourceType, resource.id).catch(() => undefined);
    }
  }, 30_000);

  test.each([
    { kind: 'height', value: 138.2, unit: 'cm' },
    { kind: 'weight', value: 32.4, unit: 'kg' },
  ] as const)('persists and reads back a $kind measurement', async ({ kind, value, unit }) => {
    await allure.epic('UN-HT-001');
    await allure.feature('DI-1');
    await Promise.all(['AC-HT-001', 'AC-HT-002', 'AC-HT-003'].map((id) => allure.label('acceptanceCriterion', id)));
    await allure.label('environment', 'docker-medplum');

    const patient = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Acceptance', given: ['Health Tracking'] }],
    });
    createdResources.push({ client: medplum, resourceType: 'Patient', id: patient.id });
    const measurement = {
      id: randomUUID(),
      patientId: patient.id,
      observedAt: new Date().toISOString(),
      kind,
      value,
      unit,
    };
    const response = await fetch(`${healthTrackingUrl}measurements`, {
      method: 'POST',
      headers: { authorization: `Bearer ${medplum.getAccessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(measurement),
    });
    const responseBody: unknown = await response.json();
    const observation = await findMeasurementObservation(medplum, measurement.id);
    if (!observation?.id) {
      throw new Error(`Measurement Observation ${measurement.id} was not persisted`);
    }
    createdResources.push({ client: medplum, resourceType: 'Observation', id: observation.id });
    const provenance = await medplum.searchOne('Provenance', { target: `Observation/${observation.id}` });
    if (provenance?.id) {
      createdResources.push({ client: medplum, resourceType: 'Provenance', id: provenance.id });
    }
    const validation = await medplum.validateResource(observation);
    const composeEvidence = await readComposeEvidence();

    await allure.attachment(
      'Docker Medplum HTTP evidence',
      JSON.stringify(
        {
          request: { method: 'POST', path: '/measurements', authorization: '[REDACTED]', body: measurement },
          response: { status: response.status, body: responseBody },
          readBack: { observation, provenance },
          validation,
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );
    await allure.attachment('Docker Compose evidence', composeEvidence, { contentType: 'text/plain' });

    expect(response.status).toBe(201);
    expect(responseBody).toEqual({ type: 'MEASUREMENT_RECORDED', payload: measurement });
    expect(observation).toMatchObject({
      resourceType: 'Observation',
      identifier: [{ system: MEASUREMENT_IDENTIFIER_SYSTEM, value: measurement.id }],
      subject: { reference: `Patient/${patient.id}` },
      effectiveDateTime: measurement.observedAt,
      valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code: unit },
    });
    expect(provenance).toMatchObject<Partial<Provenance>>({
      resourceType: 'Provenance',
      target: [{ reference: `Observation/${observation.id}` }],
    });
    expect(validation.issue.every((issue) => issue.severity !== 'error' && issue.severity !== 'fatal')).toBe(true);
  });

  test('honors the Accounts Digitization Bot grant at measurement commit time', async () => {
    await allure.epic('UN-HT-001');
    await allure.feature('DI-3');
    await allure.label('acceptanceCriterion', 'AC-HT-004');
    await allure.label('designScenario', 'NOT_PERMITTED');
    await allure.label('environment', 'docker-medplum');
    const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-HT-004 Bot grant' });
    try {
      expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
      const member = await fixture.createLinkedMinor();
      const measurement = botMeasurement(member.id);
      const deniedBeforeGrant = await fixture.recordMeasurementAsDigitizationBot(
        digitizationBotHealthTrackingUrl,
        measurement
      );
      expect(deniedBeforeGrant.status).toBe(403);
      expect(await findMeasurementObservation(fixture.admin, measurement.id)).toBeUndefined();

      expect(
        await fixture.postAsAlice('accounts/agent-grants', {
          agentId: fixture.digitizationBotId,
          memberIds: [member.id],
          tasks: ['digitize-measurement'],
        })
      ).toMatchObject({ status: 201 });
      const recorded = await fixture.recordMeasurementAsDigitizationBot(digitizationBotHealthTrackingUrl, measurement);
      expect(recorded).toEqual({ status: 201, body: { type: 'MEASUREMENT_RECORDED', payload: measurement } });
      const observation = await findMeasurementObservation(fixture.admin, measurement.id);
      if (!observation?.id) {
        throw new Error(`Digitization Bot did not persist measurement ${measurement.id}`);
      }
      const provenance = await fixture.admin.searchOne('Provenance', { target: `Observation/${observation.id}` });
      fixture.track(observation);
      if (provenance?.id) {
        fixture.track(provenance);
      }

      expect(observation.subject?.reference).toBe(`Patient/${member.id}`);
      expect(provenance).toMatchObject<Partial<Provenance>>({
        target: [{ reference: `Observation/${observation.id}` }],
        agent: [{ who: { reference: `Bot/${fixture.digitizationBotId}` } }],
      });

      expect(
        await fixture.postAsAlice('accounts/agent-grants/revoke-member', {
          agentId: fixture.digitizationBotId,
          memberId: member.id,
        })
      ).toMatchObject({ status: 200 });
      const delayedMeasurement = botMeasurement(member.id);
      const deniedAfterRevocation = await fixture.recordMeasurementAsDigitizationBot(
        digitizationBotHealthTrackingUrl,
        delayedMeasurement
      );
      expect(deniedAfterRevocation.status).toBe(403);
      expect(await findMeasurementObservation(fixture.admin, delayedMeasurement.id)).toBeUndefined();

      await allure.attachment(
        'Digitization Bot grant evidence',
        JSON.stringify(
          {
            actor: `Bot/${fixture.digitizationBotId}`,
            member: `Patient/${member.id}`,
            deniedBeforeGrant,
            recorded,
            provenance,
            deniedAfterRevocation,
            policyAfterRevocation: await fixture.readDigitizationBotPolicy(),
          },
          null,
          2
        ),
        { contentType: 'application/json' }
      );
      await allure.attachment('Docker Compose evidence', await readComposeEvidence(), { contentType: 'text/plain' });
    } finally {
      await fixture.cleanup();
    }
  }, 300_000);
});

function botMeasurement(patientId: string) {
  return {
    id: randomUUID(),
    patientId,
    observedAt: new Date().toISOString(),
    kind: 'weight',
    value: 32.4,
    unit: 'kg',
  } as const;
}

async function findMeasurementObservation(client: MedplumClient, measurementId: string) {
  return client.searchOne('Observation', {
    identifier: `${MEASUREMENT_IDENTIFIER_SYSTEM}|${measurementId}`,
  });
}

async function loginToDockerMedplum(
  credentials: { email: string; password: string; projectDisplay?: string } = {
    email: process.env['MEDPLUM_ACCEPTANCE_EMAIL'] ?? 'admin@example.com',
    password: process.env['MEDPLUM_ACCEPTANCE_PASSWORD'] ?? 'medplum_admin',
    projectDisplay: 'Super Admin',
  }
): Promise<MedplumClient> {
  const loginClient = new MedplumClient({ baseUrl: medplumBaseUrl });
  const codeVerifier = `health-tracking-${randomUUID()}`;
  let login = await loginClient.startLogin({
    email: credentials.email,
    password: credentials.password,
    scope: 'openid',
    codeChallenge: codeVerifier,
    codeChallengeMethod: 'plain',
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

async function readComposeEvidence(): Promise<string> {
  try {
    const status = await executeFile(
      'docker',
      ['compose', '-f', 'docker-compose.acceptance.yml', 'ps', '--format', 'json'],
      { cwd: process.cwd(), maxBuffer: 2_000_000 }
    );
    const logs = await executeFile(
      'docker',
      [
        'compose',
        '-f',
        'docker-compose.acceptance.yml',
        'logs',
        '--no-color',
        '--since',
        dockerEvidenceSince,
        'medplum-server',
      ],
      { cwd: process.cwd(), maxBuffer: 2_000_000 }
    );
    return `COMPOSE STATUS\n${status.stdout}${status.stderr}\nMEDPLUM SERVER LOGS\n${logs.stdout}${logs.stderr}`;
  } catch (error) {
    return `Compose logs unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function listen(server: Server, host = '127.0.0.1'): Promise<{ server: Server; url: string; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/`, port: address.port };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
