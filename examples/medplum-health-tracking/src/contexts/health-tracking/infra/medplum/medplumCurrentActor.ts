// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { AuthenticatedActor } from '../../application/ports/currentActor';

type ProfileReader = Pick<MedplumClient, 'getProfileAsync'>;

export async function getMedplumCurrentActor(medplum: ProfileReader): Promise<AuthenticatedActor | null> {
  const profile = await medplum.getProfileAsync();

  if (!profile) {
    return null;
  }

  return {
    resourceType: profile.resourceType,
    id: profile.id,
  };
}
