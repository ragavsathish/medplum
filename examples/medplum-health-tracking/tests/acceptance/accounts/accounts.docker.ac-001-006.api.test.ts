// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createAccountDockerFixture, INVALID_PROVISIONER_ACCESS_TOKEN } from './support/accountDockerFixture';

const runDockerAcceptance = process.env['MEDPLUM_DOCKER_ACCEPTANCE'] === '1';
const keycloakPatientIdentifierSystem = 'https://family.example/identity/keycloak-sub';
const testTimeout = 300_000;

describe.skipIf(!runDockerAcceptance)('Accounts Docker acceptance — onboarding and family link', () => {
  test.concurrent(
    'AC-ACC-001: onboarding identifies one account and its self-member profile',
    async () => {
      await traceTo('DI-ACC-001', 'AC-ACC-001');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-001' });
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
      await traceTo('DI-ACC-001', 'AC-ACC-002');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-002' });
      try {
        const onboarding = await fixture.postAsAlice<{
          payload?: { selectableMembers?: { resourceType: string; id: string }[] };
        }>('accounts/onboard');
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
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-003: Alice creates a minor profile with no observable login artifact',
    async () => {
      await traceTo('DI-ACC-002', 'AC-ACC-003');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-003' });
      try {
        expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
        const minor = await fixture.createMinorProfile({ relationship: 'guardian' });
        const patient = await fixture.admin.readResource('Patient', minor.id);
        const memberships = await fixture.admin.searchResources('ProjectMembership', {
          profile: `Patient/${minor.id}`,
        });

        expect(minor.response).toEqual({
          status: 201,
          body: {
            type: 'MINOR_PROFILE_CREATED',
            payload: {
              member: { resourceType: 'Patient', id: minor.id },
              relationship: 'guardian',
            },
          },
        });
        expect(patient.extension).toContainEqual({
          url: 'https://family.example/fhir/StructureDefinition/self-reported-family-relationship',
          extension: [
            { url: 'account-id', valueString: fixture.aliceKeycloakSubject },
            { url: 'relationship', valueCode: 'guardian' },
          ],
        });
        expect(patient.identifier).not.toContainEqual(
          expect.objectContaining({ system: keycloakPatientIdentifierSystem })
        );
        expect(memberships).toHaveLength(0);
        await allure.attachment(
          'Observable login evidence boundary',
          'No ProjectMembership or Keycloak-sub identifier is attached to the minor Patient. The current public seams do not expose an in-app approval-request artifact, so this test makes no claim about one.',
          { contentType: 'text/plain' }
        );
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-004: Alice records for Charlie only after the family link is active',
    async () => {
      await traceTo('DI-ACC-003', 'AC-ACC-004');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-004' });
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
    'AC-ACC-005: identifier collision creates no duplicate, link, or disclosure',
    async () => {
      await traceTo('DI-ACC-004', 'AC-ACC-005');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-005' });
      try {
        expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
        const identifier = {
          system: 'https://family.example/member-id',
          value: `collision-${randomUUID()}`,
        };
        const existing = await fixture.createMinorProfile({ identifier });
        const rejectedId = randomUUID();

        const collision = await fixture.postAsAlice('accounts/minor-profiles', {
          id: rejectedId,
          identifier,
          name: { given: ['Duplicate'], family: 'Acceptance' },
          birthDate: '2018-03-04',
          relationship: 'parent',
        });
        const matchingPatients = await fixture.admin.searchResources('Patient', {
          identifier: `${identifier.system}|${identifier.value}`,
        });

        expect(collision).toEqual({
          status: 409,
          body: {
            type: 'MINOR_PROFILE_CREATION_REJECTED',
            payload: { reason: 'IDENTIFIER_COLLISION' },
          },
        });
        expect(JSON.stringify(collision.body)).not.toContain(existing.id);
        expect(matchingPatients).toHaveLength(1);
        expect(matchingPatients[0]?.id).toBe(existing.id);
        expect(await fixture.postAsAlice('accounts/family-links', { memberId: rejectedId })).toEqual({
          status: 409,
          body: { code: 'MINOR_PROFILE_NOT_AVAILABLE' },
        });

        const unlinkedWrite = await fixture.createObservationAsAlice(existing.id);
        expect(unlinkedWrite.status).toBe(403);
        expect(await fixture.observationWasPersisted(unlinkedWrite.identifier)).toBe(false);
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-006: a real provisioning failure does not complete or activate the family link',
    async () => {
      await traceTo('DI-ACC-003', 'AC-ACC-006');
      const fixture = await createAccountDockerFixture({ projectDisplay: 'AC-ACC-006' });
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

async function traceTo(designInput: string, acceptanceCriterion: string): Promise<void> {
  await allure.epic('Accounts');
  await allure.feature(designInput);
  await allure.label('acceptanceCriterion', acceptanceCriterion);
  await allure.label('environment', 'docker-medplum-keycloak');
}
