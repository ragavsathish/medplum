// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts family unlink — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-011 unlinks Charlie while owner and agent access are both active',
    async () => {
      await traceAccountAcceptance('DI-ACC-007', 'AC-ACC-011');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-011' });
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
      await traceAccountAcceptance('DI-ACC-007', 'AC-ACC-012');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-012' });
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

        await fixture.restartWithProvisionerPolicyIds({
          ownerPolicyId: fixture.alicePolicyId,
          agentPolicyId: randomUUID(),
        });
        const failedAgentRemoval = await fixture.postAsAlice('accounts/family-links/unlink', {
          memberId: charlie.id,
        });

        expect(failedAgentRemoval).toEqual({
          status: 503,
          body: { type: 'FAMILY_UNLINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
        });
        expect((await fixture.createObservationAsAlice(charlie.id)).status).toBe(201);
        expect((await fixture.createObservationAsDigitizer(charlie.id)).status).toBe(201);

        await fixture.restartWithProvisionerPolicyIds({
          ownerPolicyId: randomUUID(),
          agentPolicyId: fixture.digitizerPolicyId,
        });
        const failedOwnerRemoval = await fixture.postAsAlice('accounts/family-links/unlink', {
          memberId: charlie.id,
        });

        expect(failedOwnerRemoval).toEqual({
          status: 503,
          body: { type: 'FAMILY_UNLINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
        });
        expect((await fixture.createObservationAsAlice(charlie.id)).status).toBe(201);
        expect((await fixture.createObservationAsDigitizer(charlie.id)).status).toBe(201);

        await fixture.restartWithProvisionerPolicyIds({
          ownerPolicyId: fixture.alicePolicyId,
          agentPolicyId: fixture.digitizerPolicyId,
        });
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

type Fixture = Awaited<ReturnType<typeof createAccountAcceptanceFixture>>;

async function onboard(fixture: Fixture): Promise<void> {
  expect(await fixture.postAsAlice('accounts/onboard')).toMatchObject({ status: 200 });
}
