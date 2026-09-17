// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture, INVALID_PROVISIONER_ACCESS_TOKEN } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts family links — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-004: Alice records for Charlie only after the family link is active',
    async () => {
      await traceAccountAcceptance('DI-ACC-003', 'AC-ACC-004');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-004' });
      try {
        expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
        const minor = await fixture.createMinorProfile();
        const beforeLink = await fixture.createObservationAsAlice(minor.id);

        expect(beforeLink.status).toBe(403);
        expect(await fixture.observationWasPersisted(beforeLink.identifier)).toBe(false);

        const link = await fixture.postAsAlice('accounts/family-links', { memberId: minor.id });
        expect(link).toEqual({
          status: 201,
          body: {
            type: 'FAMILY_LINK_ACTIVATED',
            payload: {
              member: { resourceType: 'Patient', id: minor.id },
              selectableMembers: [
                { resourceType: 'Patient', id: fixture.alicePatientId },
                { resourceType: 'Patient', id: minor.id },
              ],
            },
          },
        });

        const afterLink = await fixture.createObservationAsAlice(minor.id);
        expect(afterLink.status).toBe(201);
        expect(await fixture.observationWasPersisted(afterLink.identifier)).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-006: a real provisioning failure does not complete or activate the family link',
    async () => {
      await traceAccountAcceptance('DI-ACC-003', 'AC-ACC-006');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-006' });
      try {
        expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
        const minor = await fixture.createMinorProfile();
        await fixture.restartWithProvisionerAccessToken(INVALID_PROVISIONER_ACCESS_TOKEN);

        const failedLink = await fixture.postAsAlice('accounts/family-links', { memberId: minor.id });
        expect(failedLink).toEqual({
          status: 503,
          body: { type: 'FAMILY_LINK_FAILED', payload: { reason: 'UNAVAILABLE' } },
        });

        const deniedWrite = await fixture.createObservationAsAlice(minor.id);
        expect(deniedWrite.status).toBe(403);
        expect(await fixture.observationWasPersisted(deniedWrite.identifier)).toBe(false);
        expect((await fixture.readAlicePolicy()).resource).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ criteria: `Observation?subject=Patient/${minor.id}` })])
        );
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );
});
