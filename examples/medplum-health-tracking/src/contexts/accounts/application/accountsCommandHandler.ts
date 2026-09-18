// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  activateFamilyLink,
  endFamilyLink,
  onboardAccount,
  registerMinorProfile,
  replaceAgentGrant,
  revokeAgentMemberAccess,
} from '../domain/account';
import type {
  CreateMinorProfileRequest,
  FamilyMemberRequest,
  GrantAgentAccessRequest,
  RevokeAgentMemberAccessRequest,
} from './contracts/accountsApi';
import type { AccountIdentity } from './ports/accountIdentityProvider';
import type { AccountRequestContext } from './ports/accountRequestContext';
import type { AccountsProvisioner, AgentGrantCommand, CreateMinorProfileCommand } from './ports/accountsProvisioner';
import type { AccountsRepository } from './ports/accountsRepository';

export type AccountsCommandHandler = ReturnType<typeof createAccountsCommandHandler>;

type AccountsCommandHandlerOptions = {
  readonly accountsRepository: AccountsRepository;
  readonly provisioner?: AccountsProvisioner;
};

export function createAccountsCommandHandler(options: AccountsCommandHandlerOptions) {
  const { accountsRepository, provisioner } = options;

  return {
    async onboard(identity: AccountIdentity) {
      const existingAccount = await accountsRepository.find(identity.accountId);
      const account = onboardAccount(existingAccount, identity.accountId, identity.selfMember.id);
      await accountsRepository.save(account);
      return {
        type: 'ACCOUNT_ONBOARDED' as const,
        payload: {
          accountId: identity.accountId,
          selfMember: identity.selfMember,
          selectableMembers: [identity.selfMember],
        },
      };
    },

    async createMinorProfile(
      identity: AccountIdentity,
      input: CreateMinorProfileRequest,
      context: AccountRequestContext
    ) {
      const account = await accountsRepository.find(identity.accountId);
      if (!account) {
        return { ok: false as const, reason: 'ACCOUNT_NOT_ONBOARDED' as const };
      }
      if (!provisioner) {
        return { ok: false as const, reason: 'PROVISIONER_UNAVAILABLE' as const };
      }

      const command = {
        accountId: identity.accountId,
        member: { id: input.id, identifier: input.identifier, name: input.name, birthDate: input.birthDate },
        relationship: input.relationship,
      } satisfies CreateMinorProfileCommand;
      const result = await provisioner.createMinorProfile(command, context);
      if (!result.ok) {
        return { ok: false as const, reason: result.reason };
      }

      const memberId = result.memberId ?? command.member.id;
      await accountsRepository.save(registerMinorProfile(account, memberId));
      return {
        ok: true as const,
        event: {
          type: 'MINOR_PROFILE_CREATED' as const,
          payload: { member: { resourceType: 'Patient' as const, id: memberId }, relationship: command.relationship },
        },
      };
    },

    async activateFamilyLink(identity: AccountIdentity, input: FamilyMemberRequest, context: AccountRequestContext) {
      const account = await accountsRepository.find(identity.accountId);
      if (!account?.minorProfileIds.has(input.memberId)) {
        return { ok: false as const, reason: 'MINOR_PROFILE_NOT_AVAILABLE' as const };
      }
      if (!provisioner?.activateOwnerAccess) {
        return { ok: false as const, reason: 'PROVISIONER_UNAVAILABLE' as const };
      }
      const result = await provisioner.activateOwnerAccess({ accountId: identity.accountId, ...input }, context);
      if (!result.ok) {
        return { ok: false as const, reason: 'FAMILY_LINK_FAILED' as const, detail: result.reason };
      }

      const linkedAccount = activateFamilyLink(account, input.memberId);
      await accountsRepository.save(linkedAccount);
      return {
        ok: true as const,
        event: {
          type: 'FAMILY_LINK_ACTIVATED' as const,
          payload: {
            member: { resourceType: 'Patient' as const, id: input.memberId },
            selectableMembers: selectableMembers(linkedAccount),
          },
        },
      };
    },

    async grantAgentAccess(identity: AccountIdentity, input: GrantAgentAccessRequest, context: AccountRequestContext) {
      const account = await accountsRepository.find(identity.accountId);
      const permittedMemberIds = account
        ? new Set([account.selfMemberId, ...account.linkedMemberIds])
        : new Set<string>();
      if (!account || input.memberIds.some((id) => !permittedMemberIds.has(id))) {
        return { ok: false as const, reason: 'INVALID_AGENT_GRANT' as const };
      }
      if (!provisioner?.activateAgentAccess) {
        return { ok: false as const, reason: 'PROVISIONER_UNAVAILABLE' as const };
      }

      const command = {
        grantorAccountId: identity.accountId,
        ...input,
        previousMemberIds: [...(account.agentGrants.get(input.agentId)?.memberIds ?? [])],
      } satisfies AgentGrantCommand;
      const result = await provisioner.activateAgentAccess(command, context);
      if (!result.ok) {
        return { ok: false as const, reason: 'AGENT_GRANT_FAILED' as const };
      }

      await accountsRepository.save(replaceAgentGrant(account, input.agentId, input.memberIds, input.tasks));
      return {
        ok: true as const,
        event: {
          type: 'AGENT_ACCESS_GRANTED' as const,
          payload: {
            grantorAccountId: identity.accountId,
            agentId: input.agentId,
            memberIds: input.memberIds,
            tasks: input.tasks,
          },
        },
      };
    },

    async revokeAgentMemberAccess(
      identity: AccountIdentity,
      input: RevokeAgentMemberAccessRequest,
      context: AccountRequestContext
    ) {
      const account = await accountsRepository.find(identity.accountId);
      const grant = account?.agentGrants.get(input.agentId);
      if (!account || !grant?.memberIds.has(input.memberId)) {
        return { ok: false as const, reason: 'AGENT_MEMBER_ACCESS_NOT_ACTIVE' as const };
      }
      if (!provisioner?.deactivateAgentAccess) {
        return { ok: false as const, reason: 'PROVISIONER_UNAVAILABLE' as const };
      }
      const result = await provisioner.deactivateAgentAccess(
        { grantorAccountId: identity.accountId, ...input },
        context
      );
      if (!result.ok) {
        return { ok: false as const, reason: 'AGENT_REVOCATION_FAILED' as const };
      }

      const revokedAccount = revokeAgentMemberAccess(account, input.agentId, input.memberId);
      await accountsRepository.save(revokedAccount);
      return {
        ok: true as const,
        event: {
          type: 'AGENT_MEMBER_ACCESS_REVOKED' as const,
          payload: {
            agentId: input.agentId,
            revokedMemberId: input.memberId,
            remainingMemberIds: [...(revokedAccount.agentGrants.get(input.agentId)?.memberIds ?? [])],
          },
        },
      };
    },

    async endFamilyLink(identity: AccountIdentity, input: FamilyMemberRequest, context: AccountRequestContext) {
      const account = await accountsRepository.find(identity.accountId);
      if (!account?.linkedMemberIds.has(input.memberId)) {
        return { ok: false as const, reason: 'FAMILY_LINK_NOT_ACTIVE' as const };
      }
      if (!provisioner?.deactivateFamilyAccess) {
        return { ok: false as const, reason: 'PROVISIONER_UNAVAILABLE' as const };
      }
      const derivativeAgentIds = [...account.agentGrants]
        .filter(([, grant]) => grant.memberIds.has(input.memberId))
        .map(([agentId]) => agentId);
      const result = await provisioner.deactivateFamilyAccess(
        { accountId: identity.accountId, memberId: input.memberId, derivativeAgentIds },
        context
      );
      if (!result.ok) {
        return { ok: false as const, reason: 'FAMILY_UNLINK_FAILED' as const, detail: result.reason };
      }

      const unlinkedAccount = endFamilyLink(account, input.memberId);
      await accountsRepository.save(unlinkedAccount);
      return {
        ok: true as const,
        event: {
          type: 'FAMILY_LINK_ENDED' as const,
          payload: { memberId: input.memberId, selectableMembers: selectableMembers(unlinkedAccount) },
        },
      };
    },
  };
}

function selectableMembers(account: { readonly selfMemberId: string; readonly linkedMemberIds: ReadonlySet<string> }) {
  return [account.selfMemberId, ...account.linkedMemberIds].map((id) => ({ resourceType: 'Patient' as const, id }));
}
