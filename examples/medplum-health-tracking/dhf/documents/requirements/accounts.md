---
id: REQ-ACC-001
kind: requirements
context: accounts
---

# Accounts — User Needs and Baseline Acceptance Criteria

**Status:** Draft design-review input. Agreed outcomes and open questions are in the [EventStorming record](../discovery/EVENT_STORMING.md). These are baseline criteria, not risk-control claims.

## Onboard Alice

**UN-ACC-001:** As Alice, I need to onboard with my authenticated identity so I can track my own wellness measurements.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-ACC-001` | After Alice authenticates, onboarding identifies one account and self-member profile for her. | `DI-ACC-001` |
| `AC-ACC-002` | Alice can select her self-member profile to record a measurement without a separate self-link or approval. | `DI-ACC-001` |

## Add minor Charlie

**UN-ACC-002:** As Alice, I need to add a profile for minor Charlie without creating a duplicate so I can record his wellness measurements without Charlie logging in.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-ACC-003` | Alice can state her parent or guardian relationship and create Charlie's minor profile; Charlie receives no login or in-app approval request. | `DI-ACC-002` |
| `AC-ACC-004` | After Charlie's family link and Alice's access are active, Alice can select Charlie's profile to record his measurements. | `DI-ACC-003` |
| `AC-ACC-005` | When Charlie's identifier matches an existing Patient, online onboarding stops without creating a duplicate or automatically linking or disclosing that Patient. | `DI-ACC-004` |
| `AC-ACC-006` | If Alice's Charlie access cannot be activated, the family link is not reported as complete. | `DI-ACC-003` |

The collision message and Medplum admin recovery path remain open; this draft does not invent acceptance criteria for them.

## Delegate digitization

**UN-ACC-003:** As Alice, I need to grant and revoke the Digitization Bot's access for selected family profiles so it can digitize measurements without receiving my broader access.

In this requirement, the **digitization agent is the Medplum Bot**. It is a non-human service actor, not a delegated
person and not Alice acting through another credential.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-ACC-007` | Alice can grant the Digitization Bot access to selected profiles and the `digitize-measurement` task; the grant identifies Alice as grantor, the Bot service identity, the selected profiles, and the permitted task. | `DI-ACC-005` |
| `AC-ACC-008` | Without an active grant from Alice, the Digitization Bot cannot act for any of her profiles; with an active grant, it can perform only the granted task for the granted profiles. The grant neither impersonates Alice nor changes her own access. | `DI-ACC-005` |
| `AC-ACC-009` | Removing Charlie from the Bot grant ends its Charlie access while leaving its Alice access and Alice's own Charlie access unchanged. | `DI-ACC-006` |
| `AC-ACC-010` | A delayed Bot operation for a revoked profile is refused when current permission is checked and does not record or update data for that profile. | `DI-ACC-006` |

Mobile source permission is a separate choice from this grant. For a photo, the grant permits the Bot to extract a
candidate; it does not permit the Bot to confirm that candidate as Alice.

## End the Charlie family link

**UN-ACC-004:** As Alice, I need to end Charlie's family link so neither I nor the Digitization Bot can continue acting for him through that link.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-ACC-011` | Ending the link removes both Alice's and the Bot's derivative Charlie access before `Charlie Unlinked from Alice's Family` is reported. | `DI-ACC-007` |
| `AC-ACC-012` | If either access removal fails, the link remains active and the unlink is reported as failed, not complete. | `DI-ACC-007` |

## Traceability

| User need | EventStorming outcome | AC | Design description |
|---|---|---|---|
| `UN-ACC-001` | Account Onboarded | `AC-ACC-001`–`002` | [Accounts SDD](../design/accounts.md) |
| `UN-ACC-002` | Charlie's Minor Profile Created; Family Link Failed | `AC-ACC-003`–`006` | [Accounts SDD](../design/accounts.md) |
| `UN-ACC-003` | Agent Access Granted; Agent Access to Charlie Revoked | `AC-ACC-007`–`010` | [Accounts SDD](../design/accounts.md) |
| `UN-ACC-004` | Charlie Unlinked; Family Unlink Failed | `AC-ACC-011`–`012` | [Accounts SDD](../design/accounts.md) |

Safety and STRIDE evaluation remains separate. No risk-based AC or verified control is added here.
