---
id: SDD-HT-001
kind: design
context: health-tracking
satisfies:
  - UN-HT-001
  - UN-HT-002
  - UN-HT-004
design_inputs:
  - id: DI-1
    text: >-
      Health Tracking shall record a committed height measurement for the
      selected member as a Medplum FHIR Observation with recorder Provenance.
    traces_to: [UN-HT-001]
  - id: DI-2
    text: >-
      Health Tracking shall record a committed weight measurement for the
      selected member as a Medplum FHIR Observation with recorder Provenance.
    traces_to: [UN-HT-001]
  - id: DI-3
    text: >-
      Health Tracking shall report Measurement Recorded or Measurement Corrected
      only after the corresponding Medplum commit is confirmed, and shall
      distinguish known refusal, known failure, and unconfirmed commit.
    traces_to: [UN-HT-001, UN-HT-004]
  - id: DI-14
    text: >-
      Health Tracking shall keep the selected member as the measurement's sole
      fixed subject and record the submitting actor separately as recorder.
    traces_to: [UN-HT-001]
  - id: DI-15
    text: >-
      Health Tracking shall present a photo-derived candidate value, unit, and
      profile to Alice and shall commit no measurement until Alice confirms them.
    traces_to: [UN-HT-002]
  - id: DI-16
    text: >-
      Health Tracking shall retain the original source photo under Alice's
      restricted access after either confirmation or rejection, and shall
      record no measurement from a rejected candidate.
    traces_to: [UN-HT-002]
  - id: DI-17
    text: >-
      Health Tracking shall end the agent's access to a source photo when its
      digitization attempt ends while preserving Alice's restricted access.
    traces_to: [UN-HT-002]
  - id: DI-20
    text: >-
      Health Tracking shall commit a measurement value correction without
      changing its member and shall preserve the earlier value in Medplum history.
    traces_to: [UN-HT-004]
  - id: DI-21
    text: >-
      Health Tracking shall resolve a wrong-profile measurement by retracting
      it and creating a new measurement for the correct member, never by
      transferring the original measurement's subject.
    traces_to: [UN-HT-004]
---

# Health Tracking — Software Design Description

**Status:** Proposed design for PR1 review; not verified.

## Purpose and scope

This SDD allocates [manual recording, photo digitization, and correction needs](../requirements/health_tracking.md) to one Health Tracking context. A measurement has one member subject; Alice or her restricted agent is a separate recorder. Photo extraction proposes a candidate, not a saved measurement. Mobile steps and sleep are covered in the [Mobile Import SDD](./mobile_health_sync.md).

Medplum is the external FHIR repository and execution-time authorization point. The OpenAPI entities own payload shapes; this SDD does not repeat them. It describes required behavior and responsibility boundaries, not file layout or command-handler coding conventions.

## Design-input allocation

| Input | Baseline AC | Responsibility |
|---|---|---|
| `DI-14` | `AC-HT-001` | Fixed member subject and separate recorder |
| `DI-1`, `DI-2` | `AC-HT-002`–`003` | Height and weight FHIR projection |
| `DI-3` | `AC-HT-004`, `018` | Confirmed versus refused, failed, or uncertain outcome |
| `DI-15` | `AC-HT-005`–`006` | Candidate review before photo-derived commit |
| `DI-16`, `DI-17` | `AC-HT-007`–`008` | Restricted source-photo retention and attempt access |
| `DI-20`, `DI-21` | `AC-HT-016`–`017` | Historical correction and wrong-profile retraction |

These are baseline design inputs, not evaluated risk controls.

## C3 — Proposed Health Tracking service responsibilities

```mermaid
flowchart LR
    caller["Alice or Limited Agent<br/>Actor via external app"]
    medplum["Medplum<br/>External Software System<br/>FHIR storage, history, and access enforcement"]
    accounts["Accounts Service<br/>External Container<br/>Family and agent grants"]

    subgraph tracking["Health Tracking Service — Container"]
        entry["Measurement Entry<br/>Component<br/>Receives actor-scoped commands and returns outcomes"]
        decision["Measurement Decision<br/>Component<br/>Protects fixed subject and measurement validity"]
        photo["Photo Review<br/>Component<br/>Keeps candidate separate until Alice confirms"]
        correction["Correction Decision<br/>Component<br/>Corrects or retracts without subject transfer"]
        evidence["Photo Access Boundary<br/>Component<br/>Ends agent access after attempt"]
        fhir["Medplum Gateway<br/>Component<br/>Commits Observation and Provenance"]
    end

    caller -->|"Submits manual, photo-review, or correction request"| entry
    accounts -->|"Provides grantor and selected-profile facts for provenance"| entry
    entry -->|"Requests measurement decision"| decision
    entry -->|"Requests candidate review"| photo
    entry -->|"Requests correction decision"| correction
    photo -->|"Ends attempt access"| evidence
    decision -->|"Requests confirmed FHIR commit"| fhir
    photo -->|"Requests commit only after Alice confirms"| fhir
    correction -->|"Requests history-preserving change"| fhir
    evidence -->|"Restricts retained photo access"| medplum
    fhir -->|"Writes with caller-scoped authority"| medplum
```

The arrows from Accounts carry grant facts, not a cached authorization decision. Medplum checks access again at save time. Components are logical responsibilities; the diagram does not decide deployment or require classes.

## Dynamic view — Photo-derived measurement

```mermaid
sequenceDiagram
    participant Alice
    participant Agent as Limited Agent
    participant Tracking as Health Tracking
    participant Medplum

    Alice->>Tracking: Select Alice or Charlie profile and submit photo
    Tracking->>Agent: Permit this digitization attempt
    Agent-->>Tracking: Candidate value and unit
    Tracking-->>Alice: Show candidate, profile, and original photo
    alt Alice rejects
        Alice->>Tracking: Reject candidate
        Tracking-->>Alice: No measurement recorded and photo retained
    else Alice confirms
        Alice->>Tracking: Confirm value, unit, and profile
        Tracking->>Medplum: Commit Observation and recorder/grantor Provenance
        Medplum-->>Tracking: Confirmed, refused, failed, or uncertain outcome
        Tracking-->>Alice: Report only the known outcome
    end
    Tracking->>Agent: End photo access for this attempt
```

The original photo remains restricted evidence for Alice in either review outcome. A known refusal, technical failure, or unconfirmed commit is not reported as `Measurement Recorded`.

## Medplum and authorization boundary

- Health Tracking maps a committed measurement to a FHIR `Observation` and recorder/grantor provenance to `Provenance`. Medplum preserves resource history for corrections.
- Measurement writes use the current Alice- or agent-scoped authority. There is no broad service account in the measurement write path; Medplum permission is checked on each attempted save.
- Agent grant facts do not confer FHIR permission by themselves. A confirmed `403` after grant revocation refuses the save; an uncertain commit remains unconfirmed until reconciled.
- [Medplum's Binary policy matcher](../../../../../packages/core/src/access.ts) does not apply per-photo criteria. Exact-photo temporary access may require an application-mediated boundary; its mechanism and direct Binary/presigned-URL tests remain open. `DI-17` states the desired result, not a verified mechanism.

## Open design points

- The retained-photo deletion period is not yet selected.
- The photo access boundary must be chosen and tested before claiming that the agent cannot read a retained photo after attempt closure.
- The profile-selection API contract and existing measurement implementation must be reconciled; OpenAPI owns the final shape.

No verification evidence, control effectiveness, or residual-risk decision is claimed.
