---
id: REQ-ACC-001
kind: requirements
context: accounts
---

# Accounts Requirements

**Status:** Draft workshop baseline. See the Accounts events in
[EVENT_STORMING.md](../../../examples/medplum-health-tracking/src/contexts/health-tracking/EVENT_STORMING.md).

## Onboard an account

**UN-ACC-001:** A person needs to onboard an account linked to their authenticated identity so they can track their
own measurements.

### Baseline acceptance criteria

| ID | Acceptance criterion | Design input |
| --- | --- | --- |
| `AC-ACC-001` | Given an authenticated person, when `Onboard Account` succeeds, `Account Onboarded` identifies that person's account and self-member record. | Pending |
| `AC-ACC-002` | The onboarded person can act as the recorder for their own member record. | Pending |

## Grant family access

**UN-ACC-002:** A person authorized to manage Alice's access needs to grant Charlie permission to act for Alice so
Charlie can record or synchronize Alice's measurements.

### Baseline acceptance criteria

| ID | Acceptance criterion | Design input |
| --- | --- | --- |
| `AC-ACC-003` | When `Grant Charlie Access to Alice` succeeds, the grant identifies Charlie as the actor and Alice as the member, and `Charlie Access Granted to Alice` is reported. | Pending |
| `AC-ACC-004` | While the grant is current, Charlie can request recording or synchronization for Alice; Alice remains the intended member. | Pending |

## Grant limited agent access

**UN-ACC-003:** A person authorized for Alice and Charlie needs to delegate measurement digitization to an agent with
narrower access than their own so the agent can handle those members' measurements but no unrelated members or tasks.

### Baseline acceptance criteria

| ID | Acceptance criterion | Design input |
| --- | --- | --- |
| `AC-ACC-005` | When `Grant Digitization Access` succeeds, `Agent Access Granted` identifies the agent, Alice and Charlie as intended members, and recording or synchronization as the permitted digitization tasks; it does not copy the person's broader access. | Pending |
| `AC-ACC-006` | At execution, the agent can request recording or synchronization only while its current grant covers the intended member and task; an out-of-scope request is refused. | Pending |

These criteria come directly from the three user needs. They do not claim that any safety or security risk has been
controlled. Account failure outcomes, revocation, and the grant-to-Medplum policy contract still need storming and
design allocation.

## Safety analysis

| ID | Hazardous sequence | Hazardous situation | Possible harm | Status |
| --- | --- | --- | --- | --- |
| `SAF-ACC-001` | An account is linked to the wrong member. | One person's measurements are recorded or viewed as another's. | Incorrect assessment or care. | Identified; not yet evaluated. |
| `SAF-ACC-002` | A family or agent grant names the wrong actor or member. | Measurements are submitted to an unintended member record. | Incorrect assessment or care. | Identified; not yet evaluated. |

## STRIDE analysis

| ID | Category | Threat | Related safety risk | Status |
| --- | --- | --- | --- | --- |
| `SEC-ACC-001` | Spoofing | An authenticated identity is represented as another account or member. | `SAF-ACC-001` | Identified; not yet evaluated. |
| `SEC-ACC-002` | Elevation of privilege | A person or agent receives authority for an unintended member or task. | `SAF-ACC-002` | Identified; not yet evaluated. |
| `SEC-ACC-003` | Tampering | Grant actor, member, task, or current status is altered. | `SAF-ACC-002` | Identified; not yet evaluated. |

## Traceability

| User need | Event-storming outcome | Baseline acceptance criteria | Design allocation |
| --- | --- | --- | --- |
| `UN-ACC-001` | `Account Onboarded` | `AC-ACC-001`–`AC-ACC-002` | Pending |
| `UN-ACC-002` | `Charlie Access Granted to Alice` | `AC-ACC-003`–`AC-ACC-004` | Pending |
| `UN-ACC-003` | `Agent Access Granted` | `AC-ACC-005`–`AC-ACC-006` | Pending |

## Risk gate

Approved risk-acceptability criteria are not yet available. The identified risks remain unevaluated; no control,
verification evidence, residual-risk decision, or risk-derived acceptance criterion is claimed.
