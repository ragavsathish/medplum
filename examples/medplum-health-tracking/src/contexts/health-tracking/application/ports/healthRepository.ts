// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Measurement } from '../../core/entities/measurement';
import { MEASUREMENT_FAILURE_REASONS } from '../../core/events/measurement.events';
import type { AuthenticatedActor } from './currentActor';

export const SAVE_MEASUREMENT_RESULTS = {
  saved: {
    ok: true,
  },
  invalid: {
    ok: false,
    reason: MEASUREMENT_FAILURE_REASONS.invalidMeasurement,
  },
  notPermitted: {
    ok: false,
    reason: MEASUREMENT_FAILURE_REASONS.notPermitted,
  },
  recordUnavailable: {
    ok: false,
    reason: MEASUREMENT_FAILURE_REASONS.recordUnavailable,
  },
  outcomeUnknown: {
    ok: false,
    reason: MEASUREMENT_FAILURE_REASONS.outcomeUnknown,
  },
} as const;

export type SaveMeasurementResult = (typeof SAVE_MEASUREMENT_RESULTS)[keyof typeof SAVE_MEASUREMENT_RESULTS];

export type HealthRepository = {
  saveMeasurement(measurement: Measurement, actor: AuthenticatedActor): Promise<SaveMeasurementResult>;
};
