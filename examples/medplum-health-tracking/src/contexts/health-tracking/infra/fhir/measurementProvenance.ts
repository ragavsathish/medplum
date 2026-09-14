// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Provenance } from '@medplum/fhirtypes';
import type { AuthenticatedActor } from '../../application/ports/currentActor';
import type { Measurement } from '../../core/entities/measurement';

export function toMeasurementProvenance(
  measurement: Measurement,
  actor: AuthenticatedActor,
  recorded: string
): Provenance {
  const observationReference = `Observation/${measurement.id}`;

  return {
    resourceType: 'Provenance',
    target: [{ reference: observationReference }],
    occurredDateTime: measurement.observedAt,
    recorded,
    activity: { text: 'Record health measurement' },
    agent: [
      {
        who: { reference: `${actor.resourceType}/${actor.id}` },
      },
    ],
  };
}
