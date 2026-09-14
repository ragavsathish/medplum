// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { forbidden, OperationOutcomeError, serverTimeout } from '@medplum/core';
import { describe, expect, test, vi } from 'vitest';
import type { AuthenticatedActor } from '../../application/ports/currentActor';
import { SAVE_MEASUREMENT_RESULTS } from '../../application/ports/healthRepository';
import { createMedplumHealthRepository } from './medplumHealthRepository';

const actor: AuthenticatedActor = { resourceType: 'RelatedPerson', id: 'parent-1' };
const measurement = {
  id: '10000000-0000-4000-8000-000000000001',
  patientId: '20000000-0000-4000-8000-000000000001',
  observedAt: '2026-09-14T08:00:00+03:00',
  kind: 'weight',
  value: 32.4,
  unit: 'kg',
} as const;

describe('medplumHealthRepository', () => {
  test('writes the measurement and actor provenance in one transaction', async () => {
    const executeBatch = vi.fn().mockResolvedValue({ resourceType: 'Bundle', type: 'transaction-response' });
    const repository = createMedplumHealthRepository({ executeBatch }, () => '2026-09-14T08:01:00+03:00');

    await expect(repository.saveMeasurement(measurement, actor)).resolves.toEqual(SAVE_MEASUREMENT_RESULTS.saved);
    expect(executeBatch).toHaveBeenCalledWith({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: expect.objectContaining({
            resourceType: 'Observation',
            id: '10000000-0000-4000-8000-000000000001',
            subject: { reference: 'Patient/20000000-0000-4000-8000-000000000001' },
            effectiveDateTime: '2026-09-14T08:00:00+03:00',
          }),
          request: { method: 'PUT', url: 'Observation/10000000-0000-4000-8000-000000000001' },
        },
        {
          resource: expect.objectContaining({
            resourceType: 'Provenance',
            target: [{ reference: 'Observation/10000000-0000-4000-8000-000000000001' }],
            recorded: '2026-09-14T08:01:00+03:00',
            agent: [{ who: { reference: 'RelatedPerson/parent-1' } }],
          }),
          request: {
            method: 'POST',
            url: 'Provenance',
            ifNoneExist: 'target=Observation/10000000-0000-4000-8000-000000000001',
          },
        },
      ],
    });
  });

  test('maps Medplum forbidden to the application authorization result', async () => {
    const executeBatch = vi.fn().mockRejectedValue(new OperationOutcomeError(forbidden));
    const repository = createMedplumHealthRepository({ executeBatch });

    await expect(repository.saveMeasurement(measurement, actor)).resolves.toEqual(
      SAVE_MEASUREMENT_RESULTS.notPermitted
    );
  });

  test('maps a forbidden transaction entry to the application authorization result', async () => {
    const executeBatch = vi.fn().mockResolvedValue({
      resourceType: 'Bundle',
      type: 'transaction-response',
      entry: [{ response: { status: '403', outcome: forbidden } }],
    });
    const repository = createMedplumHealthRepository({ executeBatch });

    await expect(repository.saveMeasurement(measurement, actor)).resolves.toEqual(
      SAVE_MEASUREMENT_RESULTS.notPermitted
    );
  });

  test('maps an explicit server failure to record unavailable', async () => {
    const executeBatch = vi.fn().mockRejectedValue(new OperationOutcomeError(serverTimeout()));
    const repository = createMedplumHealthRepository({ executeBatch });

    await expect(repository.saveMeasurement(measurement, actor)).resolves.toEqual(
      SAVE_MEASUREMENT_RESULTS.recordUnavailable
    );
  });

  test('maps a transport failure to an unconfirmed outcome', async () => {
    const executeBatch = vi.fn().mockRejectedValue(new Error('connection closed'));
    const repository = createMedplumHealthRepository({ executeBatch });

    await expect(repository.saveMeasurement(measurement, actor)).resolves.toEqual(
      SAVE_MEASUREMENT_RESULTS.outcomeUnknown
    );
  });
});
