// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { measurementSchema } from '../../core/entities/measurement';
import type { MeasurementRecorded, RecordMeasurementFailure } from '../../core/events/measurement.events';
import {
  MEASUREMENT_FAILURE_REASONS,
  measurementRecorded,
  measurementRecordingFailed,
  measurementRecordingUnconfirmed,
  measurementRejected,
} from '../../core/events/measurement.events';
import type { AuthenticatedActor } from '../ports/currentActor';
import type { HealthRepository, SaveMeasurementResult } from '../ports/healthRepository';

type RecordMeasurementDependencies = {
  readonly repository: HealthRepository;
};

export type RecordMeasurementResult =
  | { readonly ok: true; readonly event: MeasurementRecorded }
  | { readonly ok: false; readonly event: RecordMeasurementFailure };

export async function handleRecordMeasurement(
  dependencies: RecordMeasurementDependencies,
  actor: AuthenticatedActor,
  commandData: unknown
): Promise<RecordMeasurementResult> {
  const parsed = measurementSchema.safeParse(commandData);
  if (!parsed.success) {
    return { ok: false, event: measurementRejected(MEASUREMENT_FAILURE_REASONS.invalidMeasurement) };
  }

  const saved = await dependencies.repository.saveMeasurement(parsed.data, actor);
  if (!saved.ok) {
    return { ok: false, event: toFailureEvent(saved) };
  }

  return { ok: true, event: measurementRecorded(parsed.data) };
}

function toFailureEvent(result: Exclude<SaveMeasurementResult, { readonly ok: true }>): RecordMeasurementFailure {
  switch (result.reason) {
    case MEASUREMENT_FAILURE_REASONS.invalidMeasurement:
    case MEASUREMENT_FAILURE_REASONS.notPermitted:
      return measurementRejected(result.reason);
    case MEASUREMENT_FAILURE_REASONS.recordUnavailable:
      return measurementRecordingFailed();
    case MEASUREMENT_FAILURE_REASONS.outcomeUnknown:
      return measurementRecordingUnconfirmed();
  }

  return result;
}
