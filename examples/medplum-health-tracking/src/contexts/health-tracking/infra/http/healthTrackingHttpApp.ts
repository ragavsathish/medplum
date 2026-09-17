// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import express from 'express';
import type { ErrorRequestHandler, Express } from 'express';
import { recordMeasurementEndpoint } from './recordMeasurementEndpoint';

export const HEALTH_TRACKING_ROUTES = {
  recordMeasurement: '/measurements',
} as const;

type HealthTrackingHttpAppOptions = {
  readonly medplumBaseUrl: string;
};

export function createHealthTrackingHttpApp(options: HealthTrackingHttpAppOptions): Express {
  const app = express();

  app.use(express.json());
  app.post(HEALTH_TRACKING_ROUTES.recordMeasurement, async (request, response) => {
    const result = await recordMeasurementEndpoint(options.medplumBaseUrl, {
      authorization: request.get('authorization'),
      body: request.body,
    });

    response.status(result.status).json(result.body);
  });
  app.use((_request, response) => response.status(404).json({ code: 'NOT_FOUND' }));
  app.use(invalidJsonHandler);

  return app;
}

const invalidJsonHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (error instanceof SyntaxError) {
    response.status(400).json({ code: 'INVALID_JSON' });
    return;
  }

  next(error);
};
