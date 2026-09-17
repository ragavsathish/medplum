// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const keycloakPatientIdentifierSystem = 'https://family.example/identity/keycloak-sub';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts onboarding — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-001: onboarding identifies one account and its self-member profile',
    async () => {
      await traceAccountAcceptance('DI-ACC-001', 'AC-ACC-001');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-001' });
      try {
        const result = await fixture.postAsAlice('accounts/onboard');
        const patient = await fixture.admin.readResource('Patient', fixture.alicePatientId);

        expect(result).toEqual({
          status: 200,
          body: {
            type: 'ACCOUNT_ONBOARDED',
            payload: {
              accountId: fixture.aliceKeycloakSubject,
              selfMember: { resourceType: 'Patient', id: fixture.alicePatientId },
              selectableMembers: [{ resourceType: 'Patient', id: fixture.alicePatientId }],
            },
          },
        });
        expect(fixture.aliceMembership).toMatchObject({
          user: { reference: `User/${fixture.aliceAccountId}` },
          profile: { reference: `Patient/${fixture.alicePatientId}` },
        });
        expect(patient.identifier).toContainEqual({
          system: keycloakPatientIdentifierSystem,
          value: fixture.aliceKeycloakSubject,
        });
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-002: Alice records a measurement for her selected self-member profile',
    async () => {
      await traceAccountAcceptance('DI-ACC-001', 'AC-ACC-002');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-002' });
      try {
        const onboarding = await fixture.postAsAlice<{
          payload?: { selectableMembers?: { resourceType: string; id: string }[] };
        }>('accounts/onboard');
        const selfLinks = await fixture.admin.searchResources('RelatedPerson', {
          patient: `Patient/${fixture.alicePatientId}`,
        });
        const approvalRequests = await fixture.admin.searchResources('Task', {
          patient: `Patient/${fixture.alicePatientId}`,
        });
        expect(onboarding.status).toBe(200);
        expect(onboarding.body.payload?.selectableMembers).toEqual([
          { resourceType: 'Patient', id: fixture.alicePatientId },
        ]);

        const selectedProfileId = onboarding.body.payload?.selectableMembers?.[0]?.id;
        expect(selectedProfileId).toBe(fixture.alicePatientId);
        if (!selectedProfileId) {
          throw new Error('Onboarding returned no selectable self-member profile');
        }
        const submission = await fixture.createObservationAsAlice(selectedProfileId);

        expect(submission.status).toBe(201);
        expect(await fixture.observationWasPersisted(submission.identifier)).toBe(true);
        expect(selfLinks).toHaveLength(0);
        expect(approvalRequests).toHaveLength(0);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );
});
