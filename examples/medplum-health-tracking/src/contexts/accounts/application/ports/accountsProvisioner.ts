// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AgentTask, FamilyRelationship } from '../../domain/account';
import type { AccountRequestContext } from './accountRequestContext';

export type CreateMinorProfileCommand = {
  readonly accountId: string;
  readonly member: {
    readonly id: string;
    readonly identifier: { readonly system: string; readonly value: string };
    readonly name: { readonly given: readonly string[]; readonly family: string };
    readonly birthDate: string;
  };
  readonly relationship: FamilyRelationship;
};

export type MemberAccessCommand = {
  readonly accountId: string;
  readonly memberId: string;
};

export type AgentGrantCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberIds: readonly string[];
  readonly tasks: readonly AgentTask[];
  readonly previousMemberIds: readonly string[];
};

export type AgentMemberAccessCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberId: string;
};

export type FamilyAccessCommand = {
  readonly accountId: string;
  readonly memberId: string;
  readonly derivativeAgentIds: readonly string[];
};

type ProvisioningResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' };

export type AccountsProvisioner = {
  createMinorProfile(
    command: CreateMinorProfileCommand,
    context?: AccountRequestContext
  ): Promise<
    | { readonly ok: true; readonly memberId?: string }
    | { readonly ok: false; readonly reason: 'IDENTIFIER_COLLISION' | 'UNAVAILABLE' }
  >;
  activateOwnerAccess?(command: MemberAccessCommand, context?: AccountRequestContext): Promise<ProvisioningResult>;
  activateAgentAccess?(command: AgentGrantCommand, context?: AccountRequestContext): Promise<ProvisioningResult>;
  deactivateAgentAccess?(
    command: AgentMemberAccessCommand,
    context?: AccountRequestContext
  ): Promise<ProvisioningResult>;
  deactivateFamilyAccess?(command: FamilyAccessCommand, context?: AccountRequestContext): Promise<ProvisioningResult>;
};
