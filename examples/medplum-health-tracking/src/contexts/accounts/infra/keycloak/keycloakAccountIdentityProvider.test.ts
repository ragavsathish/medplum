// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createKeycloakAccountIdentityProvider } from './keycloakAccountIdentityProvider';

const keycloakBaseUrl = 'http://keycloak.test/';
const medplumBaseUrl = 'http://medplum.test/';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Keycloak Account identity provider', () => {
  test('maps an authenticated Keycloak subject to one Medplum self-member', async () => {
    server.use(
      http.get(`${keycloakBaseUrl}realms/family-wellness/protocol/openid-connect/userinfo`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer alice-keycloak-token');
        return HttpResponse.json({ sub: 'alice-keycloak-sub' });
      }),
      http.get(`${medplumBaseUrl}fhir/R4/Patient`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('identifier')).toBe(
          'https://family.example/identity/keycloak-sub|alice-keycloak-sub'
        );
        expect(request.headers.get('authorization')).toBe('Bearer medplum-directory-token');
        return HttpResponse.json({
          resourceType: 'Bundle',
          type: 'searchset',
          total: 1,
          entry: [{ resource: { resourceType: 'Patient', id: 'alice' } }],
        });
      })
    );

    const result = await identityProvider().authenticate('Bearer alice-keycloak-token');

    expect(result).toEqual({
      ok: true,
      identity: {
        accountId: 'alice-keycloak-sub',
        selfMember: { resourceType: 'Patient', id: 'alice' },
      },
    });
  });

  test('rejects a bearer token refused by Keycloak', async () => {
    server.use(
      http.get(`${keycloakBaseUrl}realms/family-wellness/protocol/openid-connect/userinfo`, () =>
        HttpResponse.json({ error: 'invalid_token' }, { status: 401 })
      )
    );

    await expect(identityProvider().authenticate('Bearer rejected-token')).resolves.toEqual({
      ok: false,
      reason: 'AUTHENTICATION_REQUIRED',
    });
  });

  test('does not onboard when the Keycloak subject has no unique self-member mapping', async () => {
    server.use(
      http.get(`${keycloakBaseUrl}realms/family-wellness/protocol/openid-connect/userinfo`, () =>
        HttpResponse.json({ sub: 'unmapped-subject' })
      ),
      http.get(`${medplumBaseUrl}fhir/R4/Patient`, () =>
        HttpResponse.json({ resourceType: 'Bundle', type: 'searchset', total: 0 })
      )
    );

    await expect(identityProvider().authenticate('Bearer unmapped-token')).resolves.toEqual({
      ok: false,
      reason: 'SELF_MEMBER_UNAVAILABLE',
    });
  });
});

function identityProvider() {
  return createKeycloakAccountIdentityProvider({
    keycloakBaseUrl,
    realm: 'family-wellness',
    medplumBaseUrl,
    medplumAccessToken: 'medplum-directory-token',
    patientIdentifierSystem: 'https://family.example/identity/keycloak-sub',
  });
}
