// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

const content = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const event = (type: string, payload: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'payload'],
  properties: {
    type: { const: type },
    payload: { type: 'object', additionalProperties: false, ...payload },
  },
});

export const ACCOUNTS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Family Wellness Accounts API', version: '1.0.0' },
  components: {
    schemas: {
      PatientReference: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceType', 'id'],
        properties: { resourceType: { const: 'Patient' }, id: { type: 'string', minLength: 1 } },
      },
      Error: {
        type: 'object',
        additionalProperties: false,
        required: ['code'],
        properties: { code: { type: 'string', minLength: 1 } },
      },
      OnboardAccountEvent: event('ACCOUNT_ONBOARDED', {
        required: ['accountId', 'selfMember', 'selectableMembers'],
        properties: {
          accountId: { type: 'string', minLength: 1 },
          selfMember: { $ref: '#/components/schemas/PatientReference' },
          selectableMembers: { type: 'array', items: { $ref: '#/components/schemas/PatientReference' } },
        },
      }),
      CreateMinorProfileCommand: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'identifier', 'name', 'birthDate', 'relationship'],
        properties: {
          id: { type: 'string', minLength: 1 },
          identifier: {
            type: 'object',
            additionalProperties: false,
            required: ['system', 'value'],
            properties: { system: { type: 'string', format: 'uri' }, value: { type: 'string', minLength: 1 } },
          },
          name: {
            type: 'object',
            additionalProperties: false,
            required: ['given', 'family'],
            properties: {
              given: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              family: { type: 'string', minLength: 1 },
            },
          },
          birthDate: { type: 'string', format: 'date' },
          relationship: { type: 'string', enum: ['parent', 'guardian'] },
        },
      },
      MinorProfileCreatedEvent: event('MINOR_PROFILE_CREATED', {
        required: ['member', 'relationship'],
        properties: {
          member: { $ref: '#/components/schemas/PatientReference' },
          relationship: { type: 'string', enum: ['parent', 'guardian'] },
        },
      }),
      ActivateFamilyLinkCommand: {
        type: 'object',
        additionalProperties: false,
        required: ['memberId'],
        properties: { memberId: { type: 'string', minLength: 1 } },
      },
      FamilyLinkActivatedEvent: event('FAMILY_LINK_ACTIVATED', {
        required: ['member', 'selectableMembers'],
        properties: {
          member: { $ref: '#/components/schemas/PatientReference' },
          selectableMembers: { type: 'array', items: { $ref: '#/components/schemas/PatientReference' } },
        },
      }),
      AgentTask: { type: 'string', enum: ['digitize-measurement'] },
      GrantAgentAccessCommand: {
        type: 'object',
        additionalProperties: false,
        required: ['agentId', 'memberIds', 'tasks'],
        properties: {
          agentId: { type: 'string', minLength: 1 },
          memberIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
          tasks: { type: 'array', minItems: 1, uniqueItems: true, items: { $ref: '#/components/schemas/AgentTask' } },
        },
      },
      AgentAccessGrantedEvent: event('AGENT_ACCESS_GRANTED', {
        required: ['grantorAccountId', 'agentId', 'memberIds', 'tasks'],
        properties: {
          grantorAccountId: { type: 'string', minLength: 1 },
          agentId: { type: 'string', minLength: 1 },
          memberIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          tasks: { type: 'array', items: { $ref: '#/components/schemas/AgentTask' } },
        },
      }),
      RevokeAgentMemberAccessCommand: {
        type: 'object',
        additionalProperties: false,
        required: ['agentId', 'memberId'],
        properties: { agentId: { type: 'string', minLength: 1 }, memberId: { type: 'string', minLength: 1 } },
      },
      AgentMemberAccessRevokedEvent: event('AGENT_MEMBER_ACCESS_REVOKED', {
        required: ['agentId', 'revokedMemberId', 'remainingMemberIds'],
        properties: {
          agentId: { type: 'string', minLength: 1 },
          revokedMemberId: { type: 'string', minLength: 1 },
          remainingMemberIds: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      }),
      UnlinkFamilyMemberCommand: {
        type: 'object',
        additionalProperties: false,
        required: ['memberId'],
        properties: { memberId: { type: 'string', minLength: 1 } },
      },
      FamilyLinkEndedEvent: event('FAMILY_LINK_ENDED', {
        required: ['memberId', 'selectableMembers'],
        properties: {
          memberId: { type: 'string', minLength: 1 },
          selectableMembers: { type: 'array', items: { $ref: '#/components/schemas/PatientReference' } },
        },
      }),
    },
  },
  paths: {
    '/accounts/onboard': {
      post: {
        operationId: 'onboardAccount',
        summary: 'Identify the authenticated account and self-member',
        responses: {
          '200': { description: 'Account onboarded', content: content('OnboardAccountEvent') },
          '401': { description: 'Authentication required', content: content('Error') },
          '409': { description: 'Self-member unavailable', content: content('Error') },
        },
      },
    },
    '/accounts/minor-profiles': {
      post: {
        operationId: 'createMinorProfile',
        summary: 'Create a minor profile from a stated parent or guardian relationship',
        requestBody: { required: true, content: content('CreateMinorProfileCommand') },
        responses: {
          '201': { description: 'Minor profile created without a login', content: content('MinorProfileCreatedEvent') },
          '409': { description: 'Identifier collision or creation failure', content: content('Error') },
        },
      },
    },
    '/accounts/family-links': {
      post: {
        operationId: 'activateFamilyLink',
        summary: 'Activate a family link after owner access is confirmed',
        requestBody: { required: true, content: content('ActivateFamilyLinkCommand') },
        responses: {
          '201': { description: 'Family link activated', content: content('FamilyLinkActivatedEvent') },
          '503': { description: 'Access activation not confirmed', content: content('Error') },
        },
      },
    },
    '/accounts/agent-grants': {
      post: {
        operationId: 'grantDigitizationAccess',
        summary: 'Replace an agent digitization grant for selected members',
        requestBody: { required: true, content: content('GrantAgentAccessCommand') },
        responses: {
          '201': { description: 'Agent access granted', content: content('AgentAccessGrantedEvent') },
          '400': { description: 'Invalid member or task scope', content: content('Error') },
        },
      },
    },
    '/accounts/agent-grants/revoke-member': {
      post: {
        operationId: 'revokeAgentMemberAccess',
        summary: 'Remove one member from an agent grant',
        requestBody: { required: true, content: content('RevokeAgentMemberAccessCommand') },
        responses: {
          '200': { description: 'Selected agent access revoked', content: content('AgentMemberAccessRevokedEvent') },
          '503': { description: 'Revocation not confirmed', content: content('Error') },
        },
      },
    },
    '/accounts/family-links/unlink': {
      post: {
        operationId: 'unlinkFamilyMember',
        summary: 'Remove owner and derivative-agent access, then end the family link',
        requestBody: { required: true, content: content('UnlinkFamilyMemberCommand') },
        responses: {
          '200': { description: 'Family link ended', content: content('FamilyLinkEndedEvent') },
          '503': { description: 'Access removal not confirmed', content: content('Error') },
        },
      },
    },
  },
} as const;
