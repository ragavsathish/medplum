// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { LoginAuthenticationResponse } from '@medplum/core';
import { createReference, MedplumClient } from '@medplum/core';
import type { AccessPolicy, Patient, Provenance, ResourceType } from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHealthTrackingHttpApp } from '../../../examples/medplum-health-tracking/src/contexts/health-tracking/infra/http/healthTrackingHttpApp';

const runDockerAcceptance = process.env['MEDPLUM_DOCKER_ACCEPTANCE'] === '1';
const medplumBaseUrl = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const executeFile = promisify(execFile);
let healthTrackingServer: Server | undefined;
let healthTrackingUrl: string;
let medplum: MedplumClient;
let dockerEvidenceSince: string;
const createdResources: { client: MedplumClient; resourceType: ResourceType; id: string }[] = [];

describe.skipIf(!runDockerAcceptance)('Health Tracking HTTP API — Docker Medplum', () => {
  beforeAll(async () => {
    dockerEvidenceSince = new Date(Date.now() - 1_000).toISOString();
    medplum = await loginToDockerMedplum();
    const listening = await listen(createServer(createHealthTrackingHttpApp({ medplumBaseUrl })));
    healthTrackingServer = listening.server;
    healthTrackingUrl = listening.url;
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
    const observation = await medplum.readResource('Observation', measurement.id);
    createdResources.push({ client: medplum, resourceType: 'Observation', id: observation.id });
    const provenance = await medplum.searchOne('Provenance', { target: `Observation/${measurement.id}` });
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
      id: measurement.id,
      subject: { reference: `Patient/${patient.id}` },
      effectiveDateTime: measurement.observedAt,
      valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code: unit },
    });
    expect(provenance).toMatchObject<Partial<Provenance>>({
      resourceType: 'Provenance',
      target: [{ reference: `Observation/${measurement.id}` }],
    });
    expect(validation.issue.every((issue) => issue.severity !== 'error' && issue.severity !== 'fatal')).toBe(true);
  });

  test('returns 403 when a real Medplum AccessPolicy denies the write', async () => {
    await allure.epic('UN-HT-001');
    await allure.feature('DI-1');
    await allure.label('designScenario', 'NOT_PERMITTED');
    await allure.label('environment', 'docker-medplum');

    const projectAdmin = await loginToDockerMedplum({
      email: process.env['MEDPLUM_ACCEPTANCE_EMAIL'] ?? 'admin@example.com',
      password: process.env['MEDPLUM_ACCEPTANCE_PASSWORD'] ?? 'medplum_admin',
      projectDisplay: 'Health Tracking Acceptance',
    });
    await projectAdmin.getProfileAsync();
    const project = projectAdmin.getProject();
    if (!project?.id) {
      throw new Error('Docker Medplum session has no project');
    }
    const policy = await projectAdmin.createResource<AccessPolicy>({
      resourceType: 'AccessPolicy',
      name: `Health Tracking deny write ${randomUUID()}`,
    });
    createdResources.push({ client: projectAdmin, resourceType: 'AccessPolicy', id: policy.id });
    const email = `health-tracking-${randomUUID()}@example.com`;
    const password = `Acceptance-${randomUUID()}`;
    const membership = await projectAdmin.invite(project.id, {
      resourceType: 'Practitioner',
      firstName: 'Restricted',
      lastName: 'Recorder',
      email,
      password,
      sendEmail: false,
      accessPolicy: createReference(policy),
    });
    if (membership.resourceType !== 'ProjectMembership' || !membership.id || !membership.profile?.reference) {
      throw new Error('Could not create restricted acceptance user');
    }
    createdResources.push({ client: projectAdmin, resourceType: 'ProjectMembership', id: membership.id });
    const profileId = membership.profile.reference.split('/')[1];
    if (profileId) {
      createdResources.push({ client: projectAdmin, resourceType: 'Practitioner', id: profileId });
    }
    const patient = await projectAdmin.createResource<Patient>({ resourceType: 'Patient' });
    createdResources.push({ client: projectAdmin, resourceType: 'Patient', id: patient.id });
    const restrictedMedplum = await loginToDockerMedplum({ email, password, projectDisplay: project.name });
    const measurement = {
      id: randomUUID(),
      patientId: patient.id,
      observedAt: new Date().toISOString(),
      kind: 'weight',
      value: 32.4,
      unit: 'kg',
    } as const;
    createdResources.push({ client: projectAdmin, resourceType: 'Observation', id: measurement.id });
    const response = await fetch(`${healthTrackingUrl}measurements`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${restrictedMedplum.getAccessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(measurement),
    });
    const responseBody: unknown = await response.json();
    const persistedObservation = await projectAdmin.readResource('Observation', measurement.id).catch(() => undefined);
    const composeEvidence = await readComposeEvidence();

    await allure.attachment(
      'Docker AccessPolicy evidence',
      JSON.stringify(
        {
          request: { method: 'POST', path: '/measurements', authorization: '[REDACTED]', body: measurement },
          response: { status: response.status, body: responseBody },
          readBack: { observation: persistedObservation ?? null },
          accessPolicy: { id: policy.id, resourceRules: policy.resource ?? [] },
          actor: membership.profile.reference,
        },
        null,
        2
      ),
      { contentType: 'application/json' }
    );
    await allure.attachment('Docker Compose evidence', composeEvidence, { contentType: 'text/plain' });

    expect(response.status).toBe(403);
    expect(responseBody).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ code: 'forbidden' }] });
    expect(persistedObservation).toBeUndefined();
  });
});

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
      ['compose', '-f', 'docker-compose.full-stack.yml', 'ps', '--format', 'json'],
      { cwd: process.cwd(), maxBuffer: 2_000_000 }
    );
    const logs = await executeFile(
      'docker',
      [
        'compose',
        '-f',
        'docker-compose.full-stack.yml',
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
