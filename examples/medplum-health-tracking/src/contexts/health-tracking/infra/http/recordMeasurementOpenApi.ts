// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { PathItemObject, ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import { HEIGHT_UNITS, MEASUREMENT_KINDS, WEIGHT_UNITS } from '../../core/entities/measurement';
import { MEASUREMENT_EVENT_TYPES, MEASUREMENT_FAILURE_REASONS } from '../../core/events/measurement.events';

type OpenApiSchema = SchemaObject | ReferenceObject;

const measurementProperties = {
  id: { type: 'string', minLength: 1 },
  patientId: { type: 'string', minLength: 1 },
  observedAt: { type: 'string', format: 'date-time' },
  value: { type: 'number', exclusiveMinimum: 0 },
} satisfies Record<string, SchemaObject>;

export const recordMeasurementOpenApiSchemas = {
  Measurement: {
    oneOf: [{ $ref: '#/components/schemas/HeightMeasurement' }, { $ref: '#/components/schemas/WeightMeasurement' }],
    discriminator: {
      propertyName: 'kind',
      mapping: {
        [MEASUREMENT_KINDS.height]: '#/components/schemas/HeightMeasurement',
        [MEASUREMENT_KINDS.weight]: '#/components/schemas/WeightMeasurement',
      },
    },
  },
  HeightMeasurement: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'patientId', 'observedAt', 'kind', 'value', 'unit'],
    properties: {
      ...measurementProperties,
      kind: { type: 'string', enum: [MEASUREMENT_KINDS.height] },
      unit: { type: 'string', enum: [...HEIGHT_UNITS] },
    },
  },
  WeightMeasurement: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'patientId', 'observedAt', 'kind', 'value', 'unit'],
    properties: {
      ...measurementProperties,
      kind: { type: 'string', enum: [MEASUREMENT_KINDS.weight] },
      unit: { type: 'string', enum: [...WEIGHT_UNITS] },
    },
  },
  MeasurementRecorded: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: [MEASUREMENT_EVENT_TYPES.recorded] },
      payload: { $ref: '#/components/schemas/Measurement' },
    },
  },
  MeasurementRejected: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: [MEASUREMENT_EVENT_TYPES.rejected] },
      payload: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          reason: {
            type: 'string',
            enum: [MEASUREMENT_FAILURE_REASONS.invalidMeasurement, MEASUREMENT_FAILURE_REASONS.notPermitted],
          },
        },
      },
    },
  },
  MeasurementRecordingFailed: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: [MEASUREMENT_EVENT_TYPES.recordingFailed] },
      payload: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          reason: { type: 'string', enum: [MEASUREMENT_FAILURE_REASONS.recordUnavailable] },
        },
      },
    },
  },
  MeasurementRecordingUnconfirmed: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: [MEASUREMENT_EVENT_TYPES.recordingUnconfirmed] },
      payload: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          reason: { type: 'string', enum: [MEASUREMENT_FAILURE_REASONS.outcomeUnknown] },
        },
      },
    },
  },
} satisfies Record<string, OpenApiSchema>;

export const recordMeasurementOpenApiPath = {
  post: {
    summary: 'Record a height or weight measurement',
    operationId: 'recordMeasurement',
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/Measurement' },
        },
      },
    },
    responses: {
      '201': {
        description: 'The measurement was recorded in Medplum.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MeasurementRecorded' },
          },
        },
      },
      '400': {
        description: 'The request or FHIR data is invalid.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MeasurementRejected' },
          },
        },
      },
      '401': {
        description: 'The bearer token is absent or invalid.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/OperationOutcome' },
          },
        },
      },
      '403': {
        description: 'Medplum denied access to the intended member record.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MeasurementRejected' },
          },
        },
      },
      '503': {
        description: 'Recording failed or its outcome is unknown.',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/MeasurementRecordingFailed' },
                {
                  $ref: '#/components/schemas/MeasurementRecordingUnconfirmed',
                },
              ],
            },
          },
        },
      },
    },
  },
} satisfies PathItemObject;
