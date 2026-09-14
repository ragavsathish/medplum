// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

/** A domain measurement. FHIR mapping and persistence stay outside the core. */
export const MEASUREMENT_KINDS = {
  height: 'height',
  weight: 'weight',
} as const;

export const HEIGHT_UNITS = ['m', 'cm', 'in'] as const;
export const WEIGHT_UNITS = ['kg', 'g', 'mg', 'lb', 'oz'] as const;

const MEASUREMENT_ERRORS = {
  heightNotPositive: 'height must be greater than 0',
  weightNotPositive: 'weight must be greater than 0',
} as const;

const measurementBaseSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  observedAt: z.string().datetime({ offset: true }),
});

const heightMeasurementSchema = measurementBaseSchema.extend({
  kind: z.literal(MEASUREMENT_KINDS.height),
  value: z.number().finite().positive(MEASUREMENT_ERRORS.heightNotPositive),
  unit: z.enum(HEIGHT_UNITS),
});

const weightMeasurementSchema = measurementBaseSchema.extend({
  kind: z.literal(MEASUREMENT_KINDS.weight),
  value: z.number().finite().positive(MEASUREMENT_ERRORS.weightNotPositive),
  unit: z.enum(WEIGHT_UNITS),
});

export const measurementSchema = z.discriminatedUnion('kind', [heightMeasurementSchema, weightMeasurementSchema]);

export type Measurement = z.infer<typeof measurementSchema>;
export type HeightMeasurement = z.infer<typeof heightMeasurementSchema>;
export type WeightMeasurement = z.infer<typeof weightMeasurementSchema>;
