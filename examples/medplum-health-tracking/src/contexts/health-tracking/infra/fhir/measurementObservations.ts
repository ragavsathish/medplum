// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Observation } from '@medplum/fhirtypes';
import type { HeightMeasurement, WeightMeasurement } from '../../core/entities/measurement';

const HEIGHT_UCUM = { m: 'm', cm: 'cm', in: '[in_i]' } as const;
const WEIGHT_UCUM = { kg: 'kg', g: 'g', mg: 'mg', lb: '[lb_av]', oz: '[oz_av]' } as const;

export const MEASUREMENT_IDENTIFIER_SYSTEM = 'https://family.example/fhir/identifier/health-measurement';

export function toHeightObservation(measurement: HeightMeasurement): Observation {
  return toObservation(
    measurement,
    'http://hl7.org/fhir/StructureDefinition/bodyheight',
    '8302-2',
    'Body height',
    HEIGHT_UCUM[measurement.unit]
  );
}

export function toWeightObservation(measurement: WeightMeasurement): Observation {
  return toObservation(
    measurement,
    'http://hl7.org/fhir/StructureDefinition/bodyweight',
    '29463-7',
    'Body weight',
    WEIGHT_UCUM[measurement.unit]
  );
}

function toObservation(
  measurement: HeightMeasurement | WeightMeasurement,
  profile: string,
  code: string,
  display: string,
  unitCode: string
): Observation {
  return {
    resourceType: 'Observation',
    identifier: [{ system: MEASUREMENT_IDENTIFIER_SYSTEM, value: measurement.id }],
    meta: { profile: [profile] },
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
          },
        ],
      },
    ],
    code: { coding: [{ system: 'http://loinc.org', code, display }] },
    subject: { reference: `Patient/${measurement.patientId}` },
    effectiveDateTime: measurement.observedAt,
    valueQuantity: {
      value: measurement.value,
      unit: measurement.unit,
      system: 'http://unitsofmeasure.org',
      code: unitCode,
    },
  };
}
