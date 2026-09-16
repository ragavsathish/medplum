// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Bundle, Patient } from '@medplum/fhirtypes';
import type {
  AccountAuthenticationResult,
  AccountIdentityProvider,
} from '../../application/ports/accountIdentityProvider';

type KeycloakAccountIdentityProviderOptions = {
  readonly keycloakBaseUrl: string;
  readonly realm: string;
  readonly medplumBaseUrl: string;
  readonly medplumAccessToken: string;
  readonly patientIdentifierSystem: string;
};

type KeycloakUserInfo = { readonly sub?: unknown };

export function createKeycloakAccountIdentityProvider(
  options: KeycloakAccountIdentityProviderOptions
): AccountIdentityProvider {
  return {
    async authenticate(authorization) {
      if (!authorization?.match(/^Bearer\s+\S+$/i)) {
        return authenticationRequired();
      }
      const userInfoResponse = await fetch(
        new URL(
          `realms/${encodeURIComponent(options.realm)}/protocol/openid-connect/userinfo`,
          options.keycloakBaseUrl
        ),
        { headers: { authorization } }
      );
      if (!userInfoResponse.ok) {
        return authenticationRequired();
      }
      const userInfo = (await userInfoResponse.json()) as KeycloakUserInfo;
      if (typeof userInfo.sub !== 'string' || !userInfo.sub) {
        return authenticationRequired();
      }

      const query = new URLSearchParams({
        identifier: `${options.patientIdentifierSystem}|${userInfo.sub}`,
        _count: '2',
      });
      const patientResponse = await fetch(new URL(`fhir/R4/Patient?${query}`, options.medplumBaseUrl), {
        headers: { authorization: `Bearer ${options.medplumAccessToken}` },
      });
      if (!patientResponse.ok) {
        return selfMemberUnavailable();
      }
      const matches = (await patientResponse.json()) as Bundle<Patient>;
      const patients = (matches.entry ?? [])
        .map((entry) => entry.resource)
        .filter((patient): patient is Patient & { id: string } => patient?.resourceType === 'Patient' && !!patient.id);
      if (patients.length !== 1 || (matches.total !== undefined && matches.total !== 1)) {
        return selfMemberUnavailable();
      }

      return {
        ok: true,
        identity: {
          accountId: userInfo.sub,
          selfMember: { resourceType: 'Patient', id: patients[0].id },
        },
      };
    },
  };
}

function authenticationRequired(): AccountAuthenticationResult {
  return { ok: false, reason: 'AUTHENTICATION_REQUIRED' };
}

function selfMemberUnavailable(): AccountAuthenticationResult {
  return { ok: false, reason: 'SELF_MEMBER_UNAVAILABLE' };
}
