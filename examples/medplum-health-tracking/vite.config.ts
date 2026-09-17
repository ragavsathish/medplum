// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'medplum-health-tracking',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/acceptance/accounts/**/*.test.ts'],
  },
});
