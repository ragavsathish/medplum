// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import * as allure from 'allure-js-commons';

export async function traceAccountAcceptance(
  designInput: `DI-ACC-${string}`,
  acceptanceCriterion: `AC-ACC-${string}`
): Promise<void> {
  await allure.epic('Accounts');
  await allure.feature(designInput);
  await allure.label('acceptanceCriterion', acceptanceCriterion);
  await allure.label('environment', 'full-stack-medplum-keycloak');
}
