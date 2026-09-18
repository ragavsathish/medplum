// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AuthenticatedActor } from '../../application/ports/currentActor';
import { isAuthenticatedActor } from '../../application/ports/currentActor';

type ProfileReader = {
  getProfileAsync(): Promise<unknown>;
};

export async function getMedplumCurrentActor(medplum: ProfileReader): Promise<AuthenticatedActor | null> {
  const profile = await medplum.getProfileAsync();

  return isAuthenticatedActor(profile) ? { resourceType: profile.resourceType, id: profile.id } : null;
}
