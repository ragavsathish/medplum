// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { AGENT_TASKS, FAMILY_RELATIONSHIPS } from '../../domain/account';

const requiredString = z.string().min(1);

export const agentTaskSchema = z.enum(AGENT_TASKS);
export const familyRelationshipSchema = z.enum(FAMILY_RELATIONSHIPS);

export const patientReferenceSchema = z
  .object({
    resourceType: z.literal('Patient'),
    id: requiredString,
  })
  .strict();

export const errorResponseSchema = z.object({ code: requiredString }).strict();

export const createMinorProfileRequestSchema = z
  .object({
    id: requiredString,
    identifier: z.object({ system: z.string().url(), value: requiredString }).strict(),
    name: z.object({ given: z.array(requiredString).min(1), family: requiredString }).strict(),
    birthDate: z.string().date(),
    relationship: familyRelationshipSchema,
  })
  .strict();

export const familyMemberRequestSchema = z.object({ memberId: requiredString }).strict();

export const grantAgentAccessRequestSchema = z
  .object({
    agentId: requiredString,
    memberIds: z.array(requiredString).min(1),
    tasks: z.array(agentTaskSchema).min(1),
  })
  .strict();

export const revokeAgentMemberAccessRequestSchema = z
  .object({
    agentId: requiredString,
    memberId: requiredString,
  })
  .strict();

const eventSchema = <Type extends string, Payload extends z.ZodRawShape>(type: Type, payload: Payload) =>
  z
    .object({
      type: z.literal(type),
      payload: z.object(payload).strict(),
    })
    .strict();

export const onboardAccountEventSchema = eventSchema('ACCOUNT_ONBOARDED', {
  accountId: requiredString,
  selfMember: patientReferenceSchema,
  selectableMembers: z.array(patientReferenceSchema),
});

export const minorProfileCreatedEventSchema = eventSchema('MINOR_PROFILE_CREATED', {
  member: patientReferenceSchema,
  relationship: familyRelationshipSchema,
});

export const familyLinkActivatedEventSchema = eventSchema('FAMILY_LINK_ACTIVATED', {
  member: patientReferenceSchema,
  selectableMembers: z.array(patientReferenceSchema),
});

export const agentAccessGrantedEventSchema = eventSchema('AGENT_ACCESS_GRANTED', {
  grantorAccountId: requiredString,
  agentId: requiredString,
  memberIds: z.array(requiredString),
  tasks: z.array(agentTaskSchema),
});

export const agentMemberAccessRevokedEventSchema = eventSchema('AGENT_MEMBER_ACCESS_REVOKED', {
  agentId: requiredString,
  revokedMemberId: requiredString,
  remainingMemberIds: z.array(requiredString),
});

export const familyLinkEndedEventSchema = eventSchema('FAMILY_LINK_ENDED', {
  memberId: requiredString,
  selectableMembers: z.array(patientReferenceSchema),
});

export type CreateMinorProfileRequest = z.infer<typeof createMinorProfileRequestSchema>;
export type FamilyMemberRequest = z.infer<typeof familyMemberRequestSchema>;
export type GrantAgentAccessRequest = z.infer<typeof grantAgentAccessRequestSchema>;
export type RevokeAgentMemberAccessRequest = z.infer<typeof revokeAgentMemberAccessRequestSchema>;
