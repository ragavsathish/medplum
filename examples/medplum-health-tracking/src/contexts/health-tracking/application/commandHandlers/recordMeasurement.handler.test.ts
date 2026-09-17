// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test, vi } from 'vitest';
import type { AuthenticatedActor } from '../ports/currentActor';
import type { HealthRepository } from '../ports/healthRepository';
import { SAVE_MEASUREMENT_RESULTS } from '../ports/healthRepository';
import { handleRecordMeasurement } from './recordMeasurement.handler';

const actor: AuthenticatedActor = { resourceType: 'RelatedPerson', id: 'parent-1' };
const weight = {
  id: '10000000-0000-4000-8000-000000000001',
  patientId: '20000000-0000-4000-8000-000000000001',
  observedAt: '2026-09-14T08:00:00+03:00',
  kind: 'weight',
  value: 32.4,
  unit: 'kg',
} as const;
const { observedAt: _observedAt, ...missingObservedAt } = weight;

describe('handleRecordMeasurement', () => {
  test('records the event only after persistence succeeds', async () => {
    const repository: HealthRepository = { saveMeasurement: vi.fn().mockResolvedValue(SAVE_MEASUREMENT_RESULTS.saved) };

    const result = await handleRecordMeasurement({ repository }, actor, weight);

    expect(result).toEqual({ ok: true, event: { type: 'MEASUREMENT_RECORDED', payload: weight } });
    expect(repository.saveMeasurement).toHaveBeenCalledWith(weight, actor);
  });

  test.each([
    { input: missingObservedAt, description: 'missing observation time' },
    { input: { ...weight, value: 0 }, description: 'non-positive value' },
    { input: { ...weight, id: 'not-a-uuid' }, description: 'invalid FHIR resource identifier' },
    { input: { ...weight, patientId: 'not-a-uuid' }, description: 'invalid member identifier' },
  ])('rejects invalid input: $description', async ({ input }) => {
    const repository: HealthRepository = { saveMeasurement: vi.fn() };

    await expect(handleRecordMeasurement({ repository }, actor, input)).resolves.toEqual({
      ok: false,
      event: { type: 'MEASUREMENT_REJECTED', payload: { reason: 'INVALID_MEASUREMENT' } },
    });
    expect(repository.saveMeasurement).not.toHaveBeenCalled();
  });

  test.each([
    {
      repositoryResult: SAVE_MEASUREMENT_RESULTS.notPermitted,
      event: { type: 'MEASUREMENT_REJECTED', payload: { reason: 'NOT_PERMITTED' } },
    },
    {
      repositoryResult: SAVE_MEASUREMENT_RESULTS.invalid,
      event: { type: 'MEASUREMENT_REJECTED', payload: { reason: 'INVALID_MEASUREMENT' } },
    },
    {
      repositoryResult: SAVE_MEASUREMENT_RESULTS.recordUnavailable,
      event: { type: 'MEASUREMENT_RECORDING_FAILED', payload: { reason: 'RECORD_UNAVAILABLE' } },
    },
    {
      repositoryResult: SAVE_MEASUREMENT_RESULTS.outcomeUnknown,
      event: { type: 'MEASUREMENT_RECORDING_UNCONFIRMED', payload: { reason: 'OUTCOME_UNKNOWN' } },
    },
  ] as const)('maps $repositoryResult.reason to its command failure event', async ({ repositoryResult, event }) => {
    const repository: HealthRepository = { saveMeasurement: vi.fn().mockResolvedValue(repositoryResult) };

    await expect(handleRecordMeasurement({ repository }, actor, weight)).resolves.toEqual({ ok: false, event });
  });
});
