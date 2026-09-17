// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export const ACTOR_RESOURCE_TYPES = ['Patient', 'Practitioner', 'RelatedPerson'] as const;

export type AuthenticatedActor = {
  readonly resourceType: (typeof ACTOR_RESOURCE_TYPES)[number];
  readonly id: string;
};
