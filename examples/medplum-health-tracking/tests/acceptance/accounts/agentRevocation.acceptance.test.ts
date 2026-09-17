// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Identifier, Observation } from '@medplum/fhirtypes';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts agent revocation — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-009 revokes Charlie while retaining the other two access paths',
    async () => {
      await traceAccountAcceptance('DI-ACC-006', 'AC-ACC-009');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-009' });
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
      await traceAccountAcceptance('DI-ACC-006', 'AC-ACC-010');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-010' });
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
});

type Fixture = Awaited<ReturnType<typeof createAccountAcceptanceFixture>>;

async function onboard(fixture: Fixture): Promise<void> {
  expect(await fixture.postAsAlice('accounts/onboard')).toMatchObject({ status: 200 });
}
