// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    reporters: [
      'default',
      [
        'allure-vitest/reporter',
        {
          resultsDir: 'dhf/allure-results',
          globalLabels: { layer: 'api', context: 'family-wellness' },
        },
      ],
    ],
  },
});
