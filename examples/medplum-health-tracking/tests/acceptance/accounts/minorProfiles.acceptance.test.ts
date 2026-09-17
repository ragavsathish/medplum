// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { createAccountAcceptanceFixture } from './support/accountAcceptanceFixture';
import { traceAccountAcceptance } from './support/accountAcceptanceTrace';

const runAcceptance = process.env['MEDPLUM_ACCEPTANCE'] === '1';
const keycloakPatientIdentifierSystem = 'https://family.example/identity/keycloak-sub';
const testTimeout = 300_000;

describe.skipIf(!runAcceptance)('Accounts minor profiles — full-stack Medplum', () => {
  test.concurrent(
    'AC-ACC-003: Alice creates a minor profile with no observable login artifact',
    async () => {
      await traceAccountAcceptance('DI-ACC-002', 'AC-ACC-003');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-003' });
      try {
        expect((await fixture.postAsAlice('accounts/onboard')).status).toBe(200);
        const minor = await fixture.createMinorProfile({ relationship: 'guardian' });
        const patient = await fixture.admin.readResource('Patient', minor.id);
        const memberships = await fixture.admin.searchResources('ProjectMembership', {
          profile: `Patient/${minor.id}`,
        });
        const relationships = await fixture.admin.searchResources('RelatedPerson', {
          patient: `Patient/${minor.id}`,
        });
        const approvalRequests = await fixture.admin.searchResources('Task', {
          patient: `Patient/${minor.id}`,
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
        expect(approvalRequests).toHaveLength(0);
        expect(relationships).toContainEqual(
          expect.objectContaining({
            patient: { reference: `Patient/${minor.id}` },
            identifier: [
              {
                system: keycloakPatientIdentifierSystem,
                value: fixture.aliceKeycloakSubject,
              },
            ],
            relationship: [
              {
                coding: [
                  {
                    system: 'https://family.example/fhir/CodeSystem/self-reported-family-relationship',
                    code: 'guardian',
                  },
                ],
              },
            ],
          })
        );
        await allure.attachment(
          'Observable login evidence boundary',
          'No ProjectMembership or Keycloak-sub identifier is attached to the minor Patient, and no approval Task targets the minor Patient.',
          { contentType: 'text/plain' }
        );
      } finally {
        await fixture.cleanup();
      }
    },
    testTimeout
  );

  test.concurrent(
    'AC-ACC-005: identifier collision creates no duplicate, link, or disclosure',
    async () => {
      await traceAccountAcceptance('DI-ACC-004', 'AC-ACC-005');
      const fixture = await createAccountAcceptanceFixture({ projectDisplay: 'AC-ACC-005' });
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
});
