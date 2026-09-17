// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/** Technical request metadata propagated across Account infrastructure boundaries. */
export type AccountRequestContext = {
  readonly correlationTraceId?: string;
};
