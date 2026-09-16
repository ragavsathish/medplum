// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

const json = { 'application/json': { schema: { type: 'object' } } } as const;

export const ACCOUNTS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Family Wellness Accounts API', version: '1.0.0' },
  paths: {
    '/accounts/onboard': {
      post: {
        operationId: 'onboardAccount',
        summary: 'Identify the authenticated account and self-member',
        responses: {
          '200': { description: 'Account onboarded', content: json },
          '401': { description: 'Authentication required', content: json },
          '409': { description: 'Self-member unavailable', content: json },
        },
      },
    },
    '/accounts/minor-profiles': {
      post: {
        operationId: 'createMinorProfile',
        summary: 'Create a minor Patient from a stated parent or guardian relationship',
        requestBody: { required: true, content: json },
        responses: {
          '201': { description: 'Minor profile created without a login', content: json },
          '409': { description: 'Identifier collision or creation failure', content: json },
        },
      },
    },
    '/accounts/family-links': {
      post: {
        operationId: 'activateFamilyLink',
        summary: 'Activate a family link after owner access is confirmed',
        requestBody: { required: true, content: json },
        responses: {
          '201': { description: 'Family link activated', content: json },
          '503': { description: 'Access activation not confirmed', content: json },
        },
      },
    },
    '/accounts/agent-grants': {
      post: {
        operationId: 'grantDigitizationAccess',
        summary: 'Grant digitization for selected members',
        requestBody: { required: true, content: json },
        responses: {
          '201': { description: 'Agent access granted', content: json },
          '400': { description: 'Invalid member or task scope', content: json },
        },
      },
    },
    '/accounts/agent-grants/revoke-member': {
      post: {
        operationId: 'revokeAgentMemberAccess',
        summary: 'Remove one member from an agent grant',
        requestBody: { required: true, content: json },
        responses: {
          '200': { description: 'Selected agent access revoked', content: json },
          '503': { description: 'Revocation not confirmed', content: json },
        },
      },
    },
    '/accounts/family-links/unlink': {
      post: {
        operationId: 'unlinkFamilyMember',
        summary: 'Remove owner and derivative-agent access, then end the family link',
        requestBody: { required: true, content: json },
        responses: {
          '200': { description: 'Family link ended', content: json },
          '503': { description: 'One or more access removals were not confirmed', content: json },
        },
      },
    },
  },
} as const;
