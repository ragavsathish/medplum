// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy, Identifier, Observation, Patient } from '@medplum/fhirtypes';
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  createAccountDockerFixture,
  INVALID_PROVISIONER_ACCESS_TOKEN,
  requiredToken,
} from './support/accountDockerFixture';

const runDockerAcceptance = process.env['MEDPLUM_DOCKER_ACCEPTANCE'] === '1';
const testTimeout = 300_000;

describe.skipIf(!runDockerAcceptance)('Accounts delegation and unlinking — Docker Medplum', () => {
  test.concurrent(
    'AC-ACC-007 grants an agent the selected profiles and digitization task',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-007');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-007' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();

        const grant = await fixture.postAsAlice<{
          type: string;
          payload: { grantorAccountId: string; agentId: string; memberIds: string[]; tasks: string[] };
        }>('accounts/agent-grants', {
          agentId: fixture.digitizerAccountId,
          memberIds: [charlie.id],
          tasks: ['digitize-measurement'],
        });

        expect(grant).toEqual({
          status: 201,
          body: {
            type: 'AGENT_ACCESS_GRANTED',
            payload: {
              grantorAccountId: fixture.aliceKeycloakSubject,
              agentId: fixture.digitizerAccountId,
              memberIds: [charlie.id],
              tasks: ['digitize-measurement'],
            },
          },
        });
        const policy = await fixture.readDigitizerPolicy();
        expect(hasMemberRule(policy, charlie.id, 'Observation', ['create'])).toBe(true);
        expect(hasMemberRule(policy, fixture.alicePatientId, 'Observation')).toBe(false);
        expect(
          policy.resource?.some((rule) => rule.resourceType === 'Provenance' && rule.interaction?.includes('create'))
        ).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-008 permits only currently granted profiles and the digitization task',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-008');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-008' });
      try {
        await onboard(fixture);
        const granted = await fixture.createLinkedMinor();
        const ungranted = await fixture.createLinkedMinor();
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizerAccountId,
            memberIds: [granted.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });

        const grantedSave = await fixture.createObservationAsDigitizer(granted.id);
        const ungrantedSave = await fixture.createObservationAsDigitizer(ungranted.id);
        const unsupportedGrant = await fixture.postAsAlice('accounts/agent-grants', {
          agentId: fixture.digitizerAccountId,
          memberIds: [granted.id],
          tasks: ['manage-profile'],
        });
        const nonDigitizationWrite = await createPatientAsDigitizer(fixture);

        expect(grantedSave.status).toBe(201);
        expect(ungrantedSave.status).toBe(403);
        expect(await fixture.observationWasPersisted(ungrantedSave.identifier)).toBe(false);
        expect(unsupportedGrant).toEqual({ status: 400, body: { code: 'INVALID_AGENT_GRANT' } });
        expect(nonDigitizationWrite.status).toBe(403);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-009 revokes Charlie while retaining the other two access paths',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-009');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-009' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizerAccountId,
            memberIds: [fixture.alicePatientId, charlie.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });

        const revocation = await fixture.postAsAlice('accounts/agent-grants/revoke-member', {
          agentId: fixture.digitizerAccountId,
          memberId: charlie.id,
        });
        const digitizerCharlie = await fixture.createObservationAsDigitizer(charlie.id);
        const digitizerAlice = await fixture.createObservationAsDigitizer(fixture.alicePatientId);
        const aliceCharlie = await fixture.createObservationAsAlice(charlie.id);

        expect(revocation).toMatchObject({
          status: 200,
          body: {
            type: 'AGENT_MEMBER_ACCESS_REVOKED',
            payload: {
              agentId: fixture.digitizerAccountId,
              revokedMemberId: charlie.id,
              remainingMemberIds: [fixture.alicePatientId],
            },
          },
        });
        expect(digitizerCharlie.status).toBe(403);
        expect(digitizerAlice.status).toBe(201);
        expect(aliceCharlie.status).toBe(201);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-010 refuses a delayed save when the profile was revoked after request construction',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-010');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-010' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizerAccountId,
            memberIds: [charlie.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });

        const delayedIdentifier: Identifier = {
          system: 'https://family.example/test/delayed-observation-id',
          value: randomUUID(),
        };
        const delayedRequest: Partial<Observation> = {
          identifier: [delayedIdentifier],
          code: { text: 'Digitized weight prepared before revocation' },
        };
        expect(
          await fixture.postAsAlice('accounts/agent-grants/revoke-member', {
            agentId: fixture.digitizerAccountId,
            memberId: charlie.id,
          })
        ).toMatchObject({ status: 200 });

        const delayedSave = await fixture.createObservationAsDigitizer(charlie.id, delayedRequest);

        expect(delayedSave.status).toBe(403);
        expect(await fixture.observationWasPersisted(delayedIdentifier)).toBe(false);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-011 unlinks Charlie while owner and agent access are both active',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-011');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-011' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizerAccountId,
            memberIds: [charlie.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });
        expect((await fixture.createObservationAsAlice(charlie.id)).status).toBe(201);
        expect((await fixture.createObservationAsDigitizer(charlie.id)).status).toBe(201);

        const unlink = await fixture.postAsAlice('accounts/family-links/unlink', { memberId: charlie.id });
        const ownerAfterUnlink = await fixture.createObservationAsAlice(charlie.id);
        const agentAfterUnlink = await fixture.createObservationAsDigitizer(charlie.id);

        expect(unlink).toMatchObject({
          status: 200,
          body: { type: 'FAMILY_LINK_ENDED', payload: { memberId: charlie.id } },
        });
        expect(ownerAfterUnlink.status).toBe(403);
        expect(agentAfterUnlink.status).toBe(403);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-012 retains the active link and both access paths when real provisioning fails',
    async () => {
      await labelAcceptanceCriterion('AC-ACC-012');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-012' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizerAccountId,
            memberIds: [charlie.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });

        await fixture.restartWithProvisionerAccessToken(INVALID_PROVISIONER_ACCESS_TOKEN);
        const failedUnlink = await fixture.postAsAlice('accounts/family-links/unlink', { memberId: charlie.id });
        const retainedOwnerAccess = await fixture.createObservationAsAlice(charlie.id);
        const retainedAgentAccess = await fixture.createObservationAsDigitizer(charlie.id);

        expect(failedUnlink).toEqual({
          status: 503,
          body: { type: 'FAMILY_UNLINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
        });
        expect(retainedOwnerAccess.status).toBe(201);
        expect(retainedAgentAccess.status).toBe(201);

        await fixture.restartWithProvisionerAccessToken(requiredToken(fixture.admin));
        expect(await fixture.postAsAlice('accounts/family-links/unlink', { memberId: charlie.id })).toMatchObject({
          status: 200,
          body: { type: 'FAMILY_LINK_ENDED' },
        });
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );
});

type Fixture = Awaited<ReturnType<typeof createAccountDockerFixture>>;

async function onboard(fixture: Fixture): Promise<void> {
  expect(await fixture.postAsAlice('accounts/onboard')).toMatchObject({ status: 200 });
}

async function labelAcceptanceCriterion(id: `AC-ACC-${string}`): Promise<void> {
  await allure.label('acceptanceCriterion', id);
  await allure.label('environment', 'docker-medplum');
}

function hasMemberRule(
  policy: AccessPolicy,
  patientId: string,
  resourceType: 'Patient' | 'Observation',
  interactions?: string[]
): boolean {
  const criteria = resourceType === 'Patient' ? `Patient?_id=${patientId}` : `Observation?subject=Patient/${patientId}`;
  return (
    policy.resource?.some(
      (rule) =>
        rule.resourceType === resourceType &&
        rule.criteria === criteria &&
        (interactions === undefined || interactions.every((interaction) => rule.interaction?.includes(interaction)))
    ) ?? false
  );
}

async function createPatientAsDigitizer(fixture: Fixture): Promise<{ readonly status: number }> {
  const response = await fetch(new URL('fhir/R4/Patient', fixture.medplumBaseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${requiredToken(fixture.digitizer)}`,
      'content-type': 'application/fhir+json',
      traceparent: `00-${fixture.correlationTraceId}-${randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
      'x-correlation-id': fixture.correlationTraceId,
    },
    body: JSON.stringify({ resourceType: 'Patient', active: true } satisfies Patient),
  });
  const body = (await response.json()) as { resourceType?: string; id?: string };
  if ((response.status === 200 || response.status === 201) && body.resourceType === 'Patient' && body.id) {
    fixture.track({ resourceType: 'Patient', id: body.id });
  }
  return { status: response.status };
}
