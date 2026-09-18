// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export const ACTOR_RESOURCE_TYPES = ['Bot', 'Patient', 'Practitioner', 'RelatedPerson'] as const;

export type AuthenticatedActor = {
  readonly resourceType: (typeof ACTOR_RESOURCE_TYPES)[number];
  readonly id: string;
};

export function isAuthenticatedActor(value: unknown): value is AuthenticatedActor {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const actor = value as { readonly resourceType?: unknown; readonly id?: unknown };
  return (
    typeof actor.id === 'string' &&
    actor.id.length > 0 &&
    ACTOR_RESOURCE_TYPES.includes(actor.resourceType as AuthenticatedActor['resourceType'])
  );
}
