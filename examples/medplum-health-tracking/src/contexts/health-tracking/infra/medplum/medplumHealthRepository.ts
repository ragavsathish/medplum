// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import { getStatus, isOperationOutcome, OperationOutcomeError } from '@medplum/core';
import type { Bundle } from '@medplum/fhirtypes';
import type { AuthenticatedActor } from '../../application/ports/currentActor';
import type { HealthRepository, SaveMeasurementResult } from '../../application/ports/healthRepository';
import { SAVE_MEASUREMENT_RESULTS } from '../../application/ports/healthRepository';
import type { Measurement } from '../../core/entities/measurement';
import type { IdentifiedObservation } from '../fhir/measurementObservations';
import { toHeightObservation, toWeightObservation } from '../fhir/measurementObservations';
import { toMeasurementProvenance } from '../fhir/measurementProvenance';

type TransactionClient = Pick<MedplumClient, 'executeBatch'>;

export const createMedplumHealthRepository = (
  medplum: TransactionClient,
  now: () => string = () => new Date().toISOString()
): HealthRepository => ({
  saveMeasurement: async (measurement, actor) => {
    const transaction = toMeasurementTransaction(measurement, actor, now());

    try {
      const response = await medplum.executeBatch(transaction);
      return mapTransactionResponse(response);
    } catch (error) {
      return mapPersistenceError(error);
    }
  },
});

function mapTransactionResponse(response: Bundle): SaveMeasurementResult {
  const failedEntry = response.entry?.find((entry) => Number.parseInt(entry.response?.status ?? '', 10) >= 400);
  if (!failedEntry) {
    return SAVE_MEASUREMENT_RESULTS.saved;
  }

  const outcome = failedEntry.response?.outcome;
  if (isOperationOutcome(outcome)) {
    return mapPersistenceError(new OperationOutcomeError(outcome));
  }

  return SAVE_MEASUREMENT_RESULTS.outcomeUnknown;
}

function toMeasurementTransaction(measurement: Measurement, actor: AuthenticatedActor, recorded: string): Bundle {
  const observation = toObservation(measurement);
  const observationReference = `Observation/${observation.id}`;

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        resource: observation,
        request: { method: 'PUT', url: observationReference },
      },
      {
        resource: toMeasurementProvenance(measurement, actor, recorded),
        request: {
          method: 'POST',
          url: 'Provenance',
          ifNoneExist: `target=${observationReference}`,
        },
      },
    ],
  };
}

function toObservation(measurement: Measurement): IdentifiedObservation {
  return measurement.kind === 'height' ? toHeightObservation(measurement) : toWeightObservation(measurement);
}

function mapPersistenceError(error: unknown): SaveMeasurementResult {
  if (error instanceof OperationOutcomeError) {
    const status = getStatus(error.outcome);

    if (status === 401 || status === 403) {
      return SAVE_MEASUREMENT_RESULTS.notPermitted;
    }

    if (status === 400 || status === 422) {
      return SAVE_MEASUREMENT_RESULTS.invalid;
    }

    if (status === 429 || status >= 500) {
      return SAVE_MEASUREMENT_RESULTS.recordUnavailable;
    }

    throw error;
  }

  return SAVE_MEASUREMENT_RESULTS.outcomeUnknown;
}
