// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AgentTask } from '../../domain/account';

export type CreateMinorProfileCommand = {
  readonly accountId: string;
  readonly member: {
    readonly id: string;
    readonly identifier: { readonly system: string; readonly value: string };
    readonly name: { readonly given: string[]; readonly family: string };
    readonly birthDate: string;
  };
  readonly relationship: 'parent' | 'guardian';
};

export type MemberAccessCommand = { readonly accountId: string; readonly memberId: string };

export type AgentGrantCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberIds: string[];
  readonly previousMemberIds: string[];
  readonly tasks: AgentTask[];
};

export type AgentMemberAccessCommand = {
  readonly grantorAccountId: string;
  readonly agentId: string;
  readonly memberId: string;
};

export type FamilyAccessCommand = {
  readonly accountId: string;
  readonly memberId: string;
  readonly derivativeAgentIds: string[];
};

type ProvisioningResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'UNAVAILABLE' };

export type AccountsProvisioner = {
  createMinorProfile(
    command: CreateMinorProfileCommand
  ): Promise<
    | { readonly ok: true; readonly memberId?: string }
    | { readonly ok: false; readonly reason: 'IDENTIFIER_COLLISION' | 'UNAVAILABLE' }
  >;
  activateOwnerAccess?(command: MemberAccessCommand): Promise<ProvisioningResult>;
  activateAgentAccess?(command: AgentGrantCommand): Promise<ProvisioningResult>;
  deactivateAgentAccess?(command: AgentMemberAccessCommand): Promise<ProvisioningResult>;
  deactivateFamilyAccess?(command: FamilyAccessCommand): Promise<ProvisioningResult>;
};
