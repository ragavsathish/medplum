// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import type { Bot, RelatedPerson } from '@medplum/fhirtypes';
import { describe, expect, test, vi } from 'vitest';
import { getMedplumCurrentActor } from './medplumCurrentActor';

describe('medplumCurrentActor', () => {
  test('maps the profile returned by Medplum', async () => {
    const profile: WithId<RelatedPerson> = {
      resourceType: 'RelatedPerson',
      id: 'parent-1',
      patient: { reference: 'Patient/child-1' },
    };
    await expect(getMedplumCurrentActor({ getProfileAsync: vi.fn().mockResolvedValue(profile) })).resolves.toEqual({
      resourceType: 'RelatedPerson',
      id: 'parent-1',
    });
  });

  test('recognizes the scoped Medplum Digitization Bot as the recorder', async () => {
    const profile: WithId<Bot> = {
      resourceType: 'Bot',
      id: 'digitization-bot',
      name: 'Digitization Bot',
    };
    await expect(getMedplumCurrentActor({ getProfileAsync: vi.fn().mockResolvedValue(profile) })).resolves.toEqual({
      resourceType: 'Bot',
      id: 'digitization-bot',
    });
  });

  test('rejects unsupported authenticated profile resources', async () => {
    await expect(
      getMedplumCurrentActor({
        getProfileAsync: vi.fn().mockResolvedValue({ resourceType: 'ClientApplication', id: 'broad-client' }),
      })
    ).resolves.toBeNull();
  });

  test('returns null when Medplum has no authenticated profile', async () => {
    await expect(getMedplumCurrentActor({ getProfileAsync: vi.fn().mockResolvedValue(undefined) })).resolves.toBeNull();
  });
});
