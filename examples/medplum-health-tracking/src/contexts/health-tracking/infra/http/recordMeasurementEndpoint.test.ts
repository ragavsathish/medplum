// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { unauthorized } from '@medplum/core';
import { describe, expect, test } from 'vitest';
import { recordMeasurementEndpoint } from './recordMeasurementEndpoint';

describe('recordMeasurementEndpoint', () => {
  test('returns the Medplum unauthorized outcome when the bearer token is missing', async () => {
    await expect(recordMeasurementEndpoint('https://api.example.test/', { body: {} })).resolves.toEqual({
      status: 401,
      body: unauthorized,
    });
  });
});
