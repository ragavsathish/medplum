---
id: SDD-ACC-001
kind: design
context: accounts
satisfies:
  - UN-ACC-001
  - UN-ACC-002
  - UN-ACC-003
  - UN-ACC-004
design_inputs:
  - id: DI-ACC-001
    text: >-
      The Accounts system shall associate Alice's authenticated identity with
      one self-member profile and make that profile selectable for recording.
    traces_to: [UN-ACC-001]
  - id: DI-ACC-002
    text: >-
      The Accounts system shall create a minor member profile from Alice's
      self-reported parent or guardian relationship without requiring a minor login.
    traces_to: [UN-ACC-002]
  - id: DI-ACC-003
    text: >-
      The Accounts system shall report a Charlie family link as complete only
      after Medplum confirms Alice's limited Charlie access is active.
    traces_to: [UN-ACC-002]
  - id: DI-ACC-004
    text: >-
      The Accounts system shall stop online minor-profile creation on an
      existing Patient identifier collision without creating a duplicate or
      automatically linking or disclosing the existing Patient.
    traces_to: [UN-ACC-002]
  - id: DI-ACC-005
    text: >-
      The Accounts system shall deny the Medplum Bot authority over Alice's
      profiles unless Alice has an active digitization grant for its service
      identity, and shall limit granted authority to the selected member
      profiles and digitize-measurement task separately from Alice's own access.
    traces_to: [UN-ACC-003]
  - id: DI-ACC-006
    text: >-
      The Accounts system shall revoke the Digitization Bot's selected-profile
      access in Medplum without revoking Alice's own access, and shall not
      report a delayed Bot operation as authorized after that revocation.
    traces_to: [UN-ACC-003]
  - id: DI-ACC-007
    text: >-
      The Accounts system shall report Charlie unlinked only after Medplum
      confirms removal of both Alice's and the Digitization Bot's derivative
      Charlie access.
    traces_to: [UN-ACC-004]
---

# Accounts — Software Design Description

**Status:** Proposed design for PR1 review; not verified.

## Purpose and scope

This SDD allocates the [Accounts user needs and AC](../requirements/accounts.md) to account onboarding, minor profiles, family links, and a separate Digitization Bot grant. The digitization agent is the Medplum Bot service actor, not a human delegate. An identity system supplies Alice's authentication as an external fact. Medplum stores the Patient/profile and enforces the resulting access policy; Accounts owns the meaning and lifecycle of family and Bot authority.

The OpenAPI contract owns request and response shapes. This SDD does not repeat them. Identifier-collision recovery after referral to a Medplum admin remains open. The minor relationship is self-reported for the local MVP path; no independent guardian verification is claimed.

## Design-input allocation

| Input        | Baseline AC         | Responsibility                                   |
| ------------ | ------------------- | ------------------------------------------------ |
| `DI-ACC-001` | `AC-ACC-001`–`002`  | Onboarding and self-member association           |
| `DI-ACC-002` | `AC-ACC-003`        | Minor profile creation                           |
| `DI-ACC-003` | `AC-ACC-004`, `006` | Family-link completion after access provisioning |
| `DI-ACC-004` | `AC-ACC-005`        | Identifier-collision refusal                     |
| `DI-ACC-005` | `AC-ACC-007`–`008`  | Separate selected-profile Digitization Bot grant |
| `DI-ACC-006` | `AC-ACC-009`–`010`  | Profile-specific Bot revocation                  |
| `DI-ACC-007` | `AC-ACC-011`–`012`  | Family unlink after access removal               |

These are baseline design inputs, not risk-control allocations.

## C3 — Proposed Accounts service responsibilities

```mermaid
flowchart LR
    alice["Alice<br/>Person"]
    app["Family Wellness App<br/>External Container"]
    identitySystem["Identity System<br/>External Software System<br/>Authenticates Alice"]
    medplum["Medplum<br/>External Software System<br/>Patient records and access enforcement"]

    subgraph accounts["Accounts Service — Container"]
        api["Accounts Interface<br/>Component<br/>Accepts Accounts commands and reports their outcomes"]
        workflow["Accounts Workflow<br/>Component<br/>Coordinates state, domain decisions, and required external facts"]
        domain["Accounts Domain<br/>Component<br/>Defines onboarding, family-link, and Bot-grant invariants"]
        state["Accounts State<br/>Component<br/>Retains account, member, link, and grant lifecycle state"]
        identity["Identity Boundary<br/>Component<br/>Translates external identity into account and self-member facts"]
        authority["Authority Boundary<br/>Component<br/>Requests and confirms Patient and access-policy changes"]
    end

    alice -->|"Signs in and manages family"| app
    app -->|"Sends authenticated commands"| api
    api -->|"Obtains caller facts"| identity
    api -->|"Dispatches commands"| workflow
    workflow -->|"Applies invariants"| domain
    workflow -->|"Fetches and updates lifecycle state"| state
    workflow -->|"Provisions or removes authority"| authority
    identity -->|"Obtains authenticated account fact"| identitySystem
    identity -->|"Finds self-member Patient"| medplum
    authority -->|"Creates Patient and changes AccessPolicy"| medplum
```

The Accounts Interface owns transport validation and response mapping. The Accounts Workflow fetches lifecycle
state, applies the Accounts Domain invariants, invokes the required boundaries, and records the resulting state.
Identity systems and Medplum are external boundaries; their mechanisms do not determine the domain decisions.

## Decision and integration rules

- Accounts distinguishes Alice's authenticated account from a member profile and from the Digitization Bot's grant. Charlie is a minor member, not a login principal.
- A family link is not complete on an access-provisioning request alone; Medplum must confirm the resulting limited access.
- The Bot has no default authority over Alice's profiles. Its scope exists only while Alice's grant is active and is limited to selected-profile digitization, not a copy of Alice's broader policy or authority to impersonate her. Removing Charlie from the Bot grant does not remove Alice's own Charlie access or the Bot's separately granted Alice access.
- Ending the Charlie link requires both Alice and derivative Bot Charlie access to be removed before completion is reported. A failed removal leaves the link active.
- A Medplum permission refusal when the Bot attempts an operation is authoritative for current access. A past `Agent Access Granted` event cannot substitute for that check.
- Medplum resources are the durable source of truth for account, member, family-link, and agent-grant state.
- For baseline acceptance evidence, a self-link is an Accounts-created `RelatedPerson`, and an in-app approval request is a `Task` targeting the member Patient. Onboarding creates neither artifact for Alice, and minor-profile creation creates no approval `Task` for Charlie.
- The Accounts acceptance fixture executes a Medplum Bot under its own `ProjectMembership` and scoped `AccessPolicy`;
  `AC-ACC-007`–`010` observe grant and revocation behavior through that Bot identity.

## Open design points

- The exact wellness-only classification and Medplum policy must be demonstrated before claiming Charlie's clinical chart is inaccessible.
- The authorized Medplum actor and provisioning path for applying Alice's family and Bot grant changes are open. This SDD does not assume Alice or the Digitization Bot can directly edit access policy, or introduce a broad service account.
- The privacy-safe collision message and Medplum admin recovery path are not yet agreed.

No control effectiveness, residual-risk acceptability, or completed verification is claimed.
