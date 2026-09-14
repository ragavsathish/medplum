// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { forbidden, getStatus, OperationOutcomeError, unauthorized } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import { handleRecordMeasurement } from '../../application/commandHandlers/recordMeasurement.handler';
import type { RecordMeasurementFailure } from '../../core/events/measurement.events';
import { MEASUREMENT_FAILURE_REASONS } from '../../core/events/measurement.events';
import { getMedplumCurrentActor } from '../medplum/medplumCurrentActor';
import { createMedplumHealthRepository } from '../medplum/medplumHealthRepository';
import { createUserScopedMedplumClient } from '../medplum/userScopedMedplumClient';

type RecordMeasurementRequest = {
  readonly authorization?: string;
  readonly body: unknown;
};

export type RecordMeasurementResponse = {
  readonly status: number;
  readonly body: unknown;
};

export async function recordMeasurementEndpoint(
  baseUrl: string,
  request: RecordMeasurementRequest
): Promise<RecordMeasurementResponse> {
  const medplum = createUserScopedMedplumClient(baseUrl, request.authorization);

  if (!medplum) {
    return operationOutcomeResponse(unauthorized);
  }

  try {
    const actor = await getMedplumCurrentActor(medplum);

    if (!actor) {
      return operationOutcomeResponse(unauthorized);
    }

    const result = await handleRecordMeasurement(
      { repository: createMedplumHealthRepository(medplum) },
      actor,
      request.body
    );

    return result.ok ? { status: 201, body: result.event } : failureResponse(result.event);
  } catch (error) {
    if (error instanceof OperationOutcomeError) {
      return operationOutcomeResponse(error.outcome);
    }

    throw error;
  }
}

function failureResponse(event: RecordMeasurementFailure): RecordMeasurementResponse {
  if (event.type === 'MEASUREMENT_REJECTED') {
    return event.payload.reason === MEASUREMENT_FAILURE_REASONS.notPermitted
      ? operationOutcomeResponse(forbidden)
      : { status: 400, body: event };
  }

  return { status: 503, body: event };
}

function operationOutcomeResponse(outcome: OperationOutcome): RecordMeasurementResponse {
  return { status: getStatus(outcome), body: outcome };
}
