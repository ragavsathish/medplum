// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AccessPolicyResource } from '@medplum/fhirtypes';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createMedplumAccountsProvisioner } from './medplumAccountsProvisioner';

const baseUrl = 'http://medplum.test/';
const medplum = setupServer();

beforeAll(() => medplum.listen({ onUnhandledRequest: 'error' }));
afterEach(() => medplum.resetHandlers());
afterAll(() => medplum.close());

describe('Medplum Accounts provisioner', () => {
  test('uses an atomic conditional create for a new minor identifier', async () => {
    let conditionalCreate: string | null = null;
    let traceParent: string | null = null;
    const traceId = '11111111111111111111111111111111';
    medplum.use(
      http.post(`${baseUrl}fhir/R4/Patient`, ({ request }) => {
        conditionalCreate = request.headers.get('if-none-exist');
        traceParent = request.headers.get('traceparent');
        return HttpResponse.json({ resourceType: 'Patient', id: 'charlie' }, { status: 201 });
      })
    );

    const result = await provisioner().createMinorProfile(minorCommand(), { correlationTraceId: traceId });

    expect(result).toEqual({ ok: true, memberId: 'charlie' });
    expect(conditionalCreate).toBe('identifier=https://family.example/member-id|charlie-2018');
    expect(traceParent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
  });

  test('reports a conditional-create match as an identifier collision', async () => {
    medplum.use(
      http.post(`${baseUrl}fhir/R4/Patient`, () =>
        HttpResponse.json({ resourceType: 'Patient', id: 'existing-charlie' }, { status: 200 })
      )
    );

    const result = await provisioner().createMinorProfile(minorCommand());

    expect(result).toEqual({ ok: false, reason: 'IDENTIFIER_COLLISION' });
  });

  test('removes owner and derivative-agent access in one atomic FHIR transaction', async () => {
    const transactionBodies: unknown[] = [];
    medplum.use(
      http.get(`${baseUrl}fhir/R4/AccessPolicy/:id`, ({ params }) =>
        HttpResponse.json({
          resourceType: 'AccessPolicy',
          id: params['id'],
          resource: memberRules('charlie'),
        })
      ),
      http.post(`${baseUrl}fhir/R4/`, async ({ request }) => {
        transactionBodies.push(await request.json());
        return HttpResponse.json({ resourceType: 'Bundle', type: 'transaction-response' });
      })
    );
    const accountsProvisioner = createMedplumAccountsProvisioner({
      baseUrl,
      accessToken: 'provisioning-token',
      ownerPolicyIdByAccountId: new Map([['alice-user', 'owner-policy']]),
      agentPolicyIdByAgentId: new Map([['digitizer-1', 'agent-policy']]),
    });

    const result = await accountsProvisioner.deactivateFamilyAccess?.({
      accountId: 'alice-user',
      memberId: 'charlie',
      derivativeAgentIds: ['digitizer-1'],
    });

    expect(result).toEqual({ ok: true });
    expect(transactionBodies).toEqual([
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          {
            resource: { resourceType: 'AccessPolicy', id: 'owner-policy', resource: [] },
            request: { method: 'PUT', url: 'AccessPolicy/owner-policy' },
          },
          {
            resource: { resourceType: 'AccessPolicy', id: 'agent-policy', resource: [] },
            request: { method: 'PUT', url: 'AccessPolicy/agent-policy' },
          },
        ],
      },
    ]);
  });

  test('replaces stale member rules when an agent grant is narrowed', async () => {
    const updatedPolicies: unknown[] = [];
    medplum.use(
      http.get(`${baseUrl}fhir/R4/AccessPolicy/agent-policy`, () =>
        HttpResponse.json({
          resourceType: 'AccessPolicy',
          id: 'agent-policy',
          resource: [...memberRules('alice'), ...memberRules('charlie')],
        })
      ),
      http.put(`${baseUrl}fhir/R4/AccessPolicy/agent-policy`, async ({ request }) => {
        updatedPolicies.push(await request.json());
        return HttpResponse.json({ resourceType: 'AccessPolicy', id: 'agent-policy' });
      })
    );
    const accountsProvisioner = createMedplumAccountsProvisioner({
      baseUrl,
      accessToken: 'provisioning-token',
      ownerPolicyIdByAccountId: new Map(),
      agentPolicyIdByAgentId: new Map([['digitizer-1', 'agent-policy']]),
    });

    const result = await accountsProvisioner.activateAgentAccess?.({
      grantorAccountId: 'alice-user',
      agentId: 'digitizer-1',
      previousMemberIds: ['alice', 'charlie'],
      memberIds: ['alice'],
      tasks: ['digitize-measurement'],
    });

    expect(result).toEqual({ ok: true });
    expect(updatedPolicies).toEqual([
      {
        resourceType: 'AccessPolicy',
        id: 'agent-policy',
        resource: [...memberRules('alice'), { resourceType: 'Provenance', interaction: ['create'] }],
      },
    ]);
  });
});

function provisioner(): ReturnType<typeof createMedplumAccountsProvisioner> {
  return createMedplumAccountsProvisioner({
    baseUrl,
    accessToken: 'provisioning-token',
    ownerPolicyIdByAccountId: new Map(),
    agentPolicyIdByAgentId: new Map(),
  });
}

function minorCommand(): Parameters<ReturnType<typeof createMedplumAccountsProvisioner>['createMinorProfile']>[0] {
  return {
    accountId: 'alice-user',
    member: {
      id: 'proposed-charlie',
      identifier: { system: 'https://family.example/member-id', value: 'charlie-2018' },
      name: { given: ['Charlie'], family: 'Example' },
      birthDate: '2018-03-04',
    },
    relationship: 'parent' as const,
  };
}

function memberRules(memberId: string): AccessPolicyResource[] {
  return [
    {
      resourceType: 'Patient' as const,
      criteria: `Patient?_id=${memberId}`,
      interaction: ['read' as const, 'search' as const],
    },
    {
      resourceType: 'Observation' as const,
      criteria: `Observation?subject=Patient/${memberId}`,
      interaction: ['create' as const],
    },
  ];
}
