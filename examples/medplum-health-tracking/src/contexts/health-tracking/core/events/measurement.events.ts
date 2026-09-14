// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Measurement } from '../entities/measurement';

export const MEASUREMENT_EVENT_TYPES = {
  recorded: 'MEASUREMENT_RECORDED',
  rejected: 'MEASUREMENT_REJECTED',
  recordingFailed: 'MEASUREMENT_RECORDING_FAILED',
  recordingUnconfirmed: 'MEASUREMENT_RECORDING_UNCONFIRMED',
} as const;

export const MEASUREMENT_FAILURE_REASONS = {
  invalidMeasurement: 'INVALID_MEASUREMENT',
  notPermitted: 'NOT_PERMITTED',
  recordUnavailable: 'RECORD_UNAVAILABLE',
  outcomeUnknown: 'OUTCOME_UNKNOWN',
} as const;

type MeasurementRejectionReason =
  (typeof MEASUREMENT_FAILURE_REASONS)['invalidMeasurement'] | (typeof MEASUREMENT_FAILURE_REASONS)['notPermitted'];

export const measurementRecorded = (payload: Measurement) =>
  ({ type: MEASUREMENT_EVENT_TYPES.recorded, payload }) as const;

export const measurementRejected = (reason: MeasurementRejectionReason) =>
  ({ type: MEASUREMENT_EVENT_TYPES.rejected, payload: { reason } }) as const;

export const measurementRecordingFailed = () =>
  ({
    type: MEASUREMENT_EVENT_TYPES.recordingFailed,
    payload: { reason: MEASUREMENT_FAILURE_REASONS.recordUnavailable },
  }) as const;

export const measurementRecordingUnconfirmed = () =>
  ({
    type: MEASUREMENT_EVENT_TYPES.recordingUnconfirmed,
    payload: { reason: MEASUREMENT_FAILURE_REASONS.outcomeUnknown },
  }) as const;

export type MeasurementRecorded = ReturnType<typeof measurementRecorded>;
export type MeasurementRejected = ReturnType<typeof measurementRejected>;
export type MeasurementRecordingFailed = ReturnType<typeof measurementRecordingFailed>;
export type MeasurementRecordingUnconfirmed = ReturnType<typeof measurementRecordingUnconfirmed>;
export type RecordMeasurementFailure =
  MeasurementRejected | MeasurementRecordingFailed | MeasurementRecordingUnconfirmed;
