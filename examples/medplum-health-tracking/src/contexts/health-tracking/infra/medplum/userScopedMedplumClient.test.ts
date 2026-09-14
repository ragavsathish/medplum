// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import { createUserScopedMedplumClient, getBearerToken } from './userScopedMedplumClient';

describe('userScopedMedplumClient', () => {
  test.each([
    [undefined, null],
    ['', null],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer user-token', 'user-token'],
    ['bearer user-token', 'user-token'],
  ])('extracts only a bearer token from %s', (authorization, expected) => {
    expect(getBearerToken(authorization)).toBe(expected);
  });

  test('creates a Medplum client containing only the caller token', () => {
    const medplum = createUserScopedMedplumClient('https://api.example.test/', 'Bearer user-token');

    expect(medplum?.getAccessToken()).toBe('user-token');
  });

  test('does not create a Medplum client without a bearer token', () => {
    expect(createUserScopedMedplumClient('https://api.example.test/', 'Basic abc')).toBeNull();
  });
});
