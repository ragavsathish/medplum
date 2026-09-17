// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  CreateMinorProfileRequest,
  FamilyMemberRequest,
  GrantAgentAccessRequest,
  RevokeAgentMemberAccessRequest,
} from '../contracts/accountsApi';

export type CreateMinorProfileCommand = {
  readonly accountId: string;
  readonly member: Omit<CreateMinorProfileRequest, 'relationship'>;
  readonly relationship: CreateMinorProfileRequest['relationship'];
};

export type MemberAccessCommand = { readonly accountId: string } & FamilyMemberRequest;

export type AgentGrantCommand = GrantAgentAccessRequest & {
  readonly grantorAccountId: string;
  readonly previousMemberIds: string[];
};

export type AgentMemberAccessCommand = RevokeAgentMemberAccessRequest & {
  readonly grantorAccountId: string;
};

export type FamilyAccessCommand = FamilyMemberRequest & {
  readonly accountId: string;
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
