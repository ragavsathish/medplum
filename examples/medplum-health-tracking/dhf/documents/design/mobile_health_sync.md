---
id: SDD-HT-002
kind: design
context: health-tracking
satisfies:
  - UN-HT-003
design_inputs:
  - id: DI-4
    text: >-
      Health Tracking shall automatically record a new permitted,
      Alice-attributed mobile step measurement in Medplum after agent access
      and source permission are active.
    traces_to: [UN-HT-003]
  - id: DI-5
    text: >-
      Health Tracking shall automatically record a new permitted,
      Alice-attributed mobile sleep session in Medplum after agent access
      and source permission are active.
    traces_to: [UN-HT-003]
  - id: DI-6
    text: >-
      Health Tracking shall preserve the step count and observed period of an
      imported step measurement.
    traces_to: [UN-HT-003]
  - id: DI-7
    text: >-
      Health Tracking shall preserve the start, end, and total duration of an
      imported sleep session.
    traces_to: [UN-HT-003]
  - id: DI-9
    text: >-
      Health Tracking shall recognize an unchanged source record without
      creating a duplicate logical measurement.
    traces_to: [UN-HT-003]
  - id: DI-10
    text: >-
      Health Tracking shall mark an imported measurement's source absent when
      the mobile source deletes its record, without automatically retracting
      the imported measurement.
    traces_to: [UN-HT-003]
  - id: DI-13
    text: >-
      Health Tracking shall import only mobile record types available under
      Alice's current platform source permission and current agent grant.
    traces_to: [UN-HT-003]
  - id: DI-18
    text: >-
      Health Tracking shall assign automatic mobile step and sleep imports to
      Alice only when the source is attributed to Alice, and shall not infer
      Charlie from a shared device.
    traces_to: [UN-HT-003]
  - id: DI-19
    text: >-
      Health Tracking shall make an absent source status visible to Alice and
      permit her to retract the imported measurement separately.
    traces_to: [UN-HT-003]
---

# Mobile Measurement Import — Software Design Description

**Status:** Proposed design for PR1 review; not verified.

## Purpose and scope

This SDD allocates [Alice's mobile-import user need and AC](../requirements/health_tracking.md) to the structured steps and sleep path. Both Apple Health and Android Health Connect are possible source systems. Alice grants platform read permission separately from the agent's narrow Medplum digitization grant. The agent auto-submits only Alice-attributed data. Charlie may be recorded manually or through a reviewed photo, but is not inferred from a shared mobile health source.

The MVP sleep fact is one session's start, end, and total duration. Sleep stages, other mobile types, and offline capture/sync are later slices. The OpenAPI entities own payload shapes; this SDD does not repeat them.

## Design-input allocation

| Input | Baseline AC | Responsibility |
|---|---|---|
| `DI-13` | `AC-HT-009` | Separate platform source permission and agent grant |
| `DI-4`, `DI-6` | `AC-HT-010` | Automatic step import with count and period |
| `DI-5`, `DI-7` | `AC-HT-011` | Automatic sleep import with session period and duration |
| `DI-18` | `AC-HT-012` | Explicit Alice source attribution |
| `DI-9` | `AC-HT-013` | No duplicate on unchanged source record |
| `DI-10`, `DI-19` | `AC-HT-014`–`015` | Source absence without automatic retraction |

These are baseline design inputs, not evaluated risk controls. The previous sleep-stage and offline-sync inputs are not part of this MVP allocation.

## C2 — Proposed online import containers

```mermaid
flowchart LR
    alice["Alice<br/>Person"]
    source["Apple Health or Health Connect<br/>External Software System<br/>Permitted steps and sleep"]
    medplum["Medplum<br/>External Software System<br/>FHIR storage and access enforcement"]

    subgraph wellness["Family Wellness"]
        app["Flutter App<br/>Container<br/>Source permission and Alice's status view"]
        agent["Digitization Agent<br/>Container: runnable process; location open<br/>Auto-imports with restricted authority"]
        tracking["Health Tracking Service<br/>Container<br/>Applies measurement decisions and FHIR projection"]
    end

    alice -->|"Grants source access and reviews status"| app
    app -->|"Reads only permitted step and sleep types"| source
    app -->|"Provides Alice-attributed source changes"| agent
    agent -->|"Submits digitized measurements with its restricted token"| tracking
    tracking -->|"Writes Observation and Provenance under agent authority"| medplum
    tracking -->|"Returns known outcomes and source status"| agent
    agent -->|"Reports import status"| app
```

The diagram is an online logical container view. It does not decide whether the agent process runs on a phone or elsewhere, and it does not add a local sync store to the initial MVP.

## C3 — Digitization Agent responsibilities

```mermaid
flowchart LR
    app["Flutter App<br/>External Container<br/>Permitted source changes"]
    tracking["Health Tracking Service<br/>External Container<br/>Recording and source status"]

    subgraph agent["Digitization Agent"]
        admission["Source Admission<br/>Component<br/>Requires Alice attribution and permitted type"]
        decision["Import Decision<br/>Component<br/>Distinguishes new, unchanged, and absent source"]
        submission["Restricted Submission<br/>Component<br/>Uses current agent grant and token"]
    end

    app -->|"Supplies permitted source changes"| admission
    admission -->|"Passes attributed records"| decision
    decision -->|"Requests new record or absent-source update"| submission
    submission -->|"Submits under agent authority"| tracking
```

These are decision responsibilities, not required files, classes, or independent services.

## Dynamic view — New and deleted mobile source records

```mermaid
sequenceDiagram
    participant Alice
    participant Source as Mobile Health Source
    participant App as Flutter App
    participant Agent as Digitization Agent
    participant Tracking as Health Tracking
    participant Medplum

    Alice->>App: Grant source permission
    App->>Source: Read permitted steps and sleep
    Source-->>App: Alice-attributed source changes
    App->>Agent: Supply changes under separate agent grant
    alt New structured source record
        Agent->>Tracking: Request automatic measurement record
        Tracking->>Medplum: Commit FHIR measurement under agent authority
        Medplum-->>Tracking: Known or uncertain outcome
        Tracking-->>Agent: Report outcome
    else Source record deleted
        Agent->>Tracking: Mark corresponding source absent
        Tracking-->>App: Imported measurement remains and status is visible to Alice
    end
    Alice->>App: May retract imported measurement separately
```

An unchanged record creates no new logical measurement. Source deletion does not imply Alice intended to remove the imported record.

## Medplum and permission boundary

- Medplum stores committed measurements as `Observation` with source and recorder provenance; stable source identity prevents duplicate logical import. The exact source-absence FHIR representation remains a design choice.
- Platform permission allows the app to read a type; the separate agent grant and Medplum policy allow the agent to submit for Alice. Neither permission implies the other.
- A confirmed Medplum refusal after agent revocation is not retried as an authorized write. An uncertain commit is reconciled rather than reported as recorded.
- Alice's source attribution is explicit. A shared-device record is not silently assigned to Charlie.

## Open design points

- How a later source correction affects an imported value is still an EventStorming hot spot; no automatic-correction design input is allocated.
- The FHIR representation and verification of `Source Marked Absent` must be selected before implementation review.
- The agent's execution location and credential lifecycle are not decided by this SDD.

No verification evidence, control effectiveness, or residual-risk decision is claimed.
