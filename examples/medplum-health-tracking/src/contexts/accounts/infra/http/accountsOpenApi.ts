// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  agentAccessGrantedEventSchema,
  agentMemberAccessRevokedEventSchema,
  agentTaskSchema,
  createMinorProfileRequestSchema,
  errorResponseSchema,
  familyLinkActivatedEventSchema,
  familyLinkEndedEventSchema,
  familyMemberRequestSchema,
  grantAgentAccessRequestSchema,
  minorProfileCreatedEventSchema,
  onboardAccountEventSchema,
  patientReferenceSchema,
  revokeAgentMemberAccessRequestSchema,
} from '../../application/contracts/accountsApi';

const content = (schema: string) => ({
  'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
});

const openApiSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });

export const ACCOUNTS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Family Wellness Accounts API', version: '1.0.0' },
  components: {
    schemas: {
      PatientReference: openApiSchema(patientReferenceSchema),
      Error: openApiSchema(errorResponseSchema),
      OnboardAccountEvent: openApiSchema(onboardAccountEventSchema),
      CreateMinorProfileCommand: openApiSchema(createMinorProfileRequestSchema),
      MinorProfileCreatedEvent: openApiSchema(minorProfileCreatedEventSchema),
      ActivateFamilyLinkCommand: openApiSchema(familyMemberRequestSchema),
      FamilyLinkActivatedEvent: openApiSchema(familyLinkActivatedEventSchema),
      AgentTask: openApiSchema(agentTaskSchema),
      GrantAgentAccessCommand: openApiSchema(grantAgentAccessRequestSchema),
      AgentAccessGrantedEvent: openApiSchema(agentAccessGrantedEventSchema),
      RevokeAgentMemberAccessCommand: openApiSchema(revokeAgentMemberAccessRequestSchema),
      AgentMemberAccessRevokedEvent: openApiSchema(agentMemberAccessRevokedEventSchema),
      UnlinkFamilyMemberCommand: openApiSchema(familyMemberRequestSchema),
      FamilyLinkEndedEvent: openApiSchema(familyLinkEndedEventSchema),
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
          '400': { description: 'Invalid minor profile input', content: content('Error') },
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
          '400': { description: 'Invalid family link input', content: content('Error') },
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
          '400': { description: 'Invalid agent revocation input', content: content('Error') },
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
          '400': { description: 'Invalid family unlink input', content: content('Error') },
          '503': { description: 'Access removal not confirmed', content: content('Error') },
        },
      },
    },
  },
} as const;
