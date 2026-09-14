// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MedplumClient } from '@medplum/core';

const BEARER_TOKEN = /^Bearer\s+(\S+)$/i;

export function getBearerToken(authorization: string | undefined): string | null {
  return authorization?.match(BEARER_TOKEN)?.[1] ?? null;
}

export function createUserScopedMedplumClient(
  baseUrl: string,
  authorization: string | undefined
): MedplumClient | null {
  const accessToken = getBearerToken(authorization);

  if (!accessToken) {
    return null;
  }

  return new MedplumClient({ baseUrl, accessToken });
}
