// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicy } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts Digitization Bot grants — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-007 grants the Digitization Bot the selected profiles and digitization task',
    async () => {
      await traceAccountAcceptance('DI-ACC-005', 'AC-ACC-007');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-007' });
      try {
        await onboard(fixture);
        const charlie = await fixture.createLinkedMinor();

        const grant = await fixture.postAsAlice<{
          type: string;
          payload: { grantorAccountId: string; agentId: string; memberIds: string[]; tasks: string[] };
        }>('accounts/agent-grants', {
          agentId: fixture.digitizationBotId,
          memberIds: [charlie.id],
          tasks: ['digitize-measurement'],
        });

        expect(grant).toEqual({
          status: 201,
          body: {
            type: 'AGENT_ACCESS_GRANTED',
            payload: {
              grantorAccountId: fixture.aliceKeycloakSubject,
              agentId: fixture.digitizationBotId,
              memberIds: [charlie.id],
              tasks: ['digitize-measurement'],
            },
          },
        });
        const botMembership = await fixture.admin.searchOne('ProjectMembership', {
          profile: `Bot/${fixture.digitizationBotId}`,
        });
        expect(botMembership?.profile?.reference).toBe(`Bot/${fixture.digitizationBotId}`);
        const policy = await fixture.readDigitizationBotPolicy();
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
    'AC-ACC-008 denies the Bot by default and permits only currently granted profiles and task',
    async () => {
      await traceAccountAcceptance('DI-ACC-005', 'AC-ACC-008');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-008' });
      try {
        await onboard(fixture);
        const granted = await fixture.createLinkedMinor();
        const ungranted = await fixture.createLinkedMinor();
        const ownerPolicyBeforeGrant = await fixture.readAlicePolicy();
        const beforeGrant = await fixture.createObservationAsDigitizationBot(granted.id);
        expect(
          await fixture.postAsAlice('accounts/agent-grants', {
            agentId: fixture.digitizationBotId,
            memberIds: [granted.id],
            tasks: ['digitize-measurement'],
          })
        ).toMatchObject({ status: 201 });

        const grantedSave = await fixture.createObservationAsDigitizationBot(granted.id);
        const ungrantedSave = await fixture.createObservationAsDigitizationBot(ungranted.id);
        const unsupportedGrant = await fixture.postAsAlice('accounts/agent-grants', {
          agentId: fixture.digitizationBotId,
          memberIds: [granted.id],
          tasks: ['manage-profile'],
        });
        const nonDigitizationWrite = await fixture.createPatientAsDigitizationBot();
        const ownerPolicyAfterGrant = await fixture.readAlicePolicy();
        const aliceGrantedSave = await fixture.createObservationAsAlice(granted.id);
        const aliceUngrantedSave = await fixture.createObservationAsAlice(ungranted.id);

        expect(beforeGrant.status).toBe(403);
        expect(await fixture.observationWasPersisted(beforeGrant.identifier)).toBe(false);
        expect(grantedSave.status).toBe(201);
        expect(ungrantedSave.status).toBe(403);
        expect(await fixture.observationWasPersisted(ungrantedSave.identifier)).toBe(false);
        expect(unsupportedGrant).toEqual({ status: 400, body: { code: 'INVALID_AGENT_GRANT' } });
        expect(nonDigitizationWrite.status).toBe(403);
        expect(ownerPolicyAfterGrant.resource).toEqual(ownerPolicyBeforeGrant.resource);
        expect(aliceGrantedSave.status).toBe(201);
        expect(aliceUngrantedSave.status).toBe(201);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );
});

type Fixture = Awaited<ReturnType<typeof createAccountAcceptanceFixture>>;

async function onboard(fixture: Fixture): Promise<void> {
  expect(await fixture.postAsAlice('accounts/onboard')).toMatchObject({ status: 200 });
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
