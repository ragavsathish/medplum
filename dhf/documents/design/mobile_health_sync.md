---
id: SDD-HT-002
kind: design
context: health-tracking
satisfies:
  - UN-HT-002
design_inputs:
  - id: DI-2
    text: >-
      The Health Tracking system shall synchronize permitted step-count records
      and sleep sessions from a connected mobile health source to the intended
      member's Medplum health record.
    traces_to:
      - UN-HT-002
  - id: DI-3
    text: >-
      The Health Tracking system shall apply available source additions,
      changes, and deletions without duplicating unchanged records and shall
      continue safely after an incomplete synchronization.
    traces_to:
      - UN-HT-002
  - id: DI-4
    text: >-
      The Health Tracking system shall report whether synchronization completed
      and identify records that were not synchronized.
    traces_to:
      - UN-HT-002
---

# Mobile Health Synchronization — Software Design Description

**Status:** Draft.

## Purpose and scope

**Audience:** Product, mobile, server, and design reviewers.

**Decision supported:** Agree where mobile health synchronization state and responsibilities belong before defining
the API contract or implementation.

**Software system in scope:** Health Tracking, comprising the Flutter client and Health Tracking server.

The first increment synchronizes step-count records and sleep sessions from Apple HealthKit or Android Health Connect
to the intended member's record in Medplum. Other mobile health types are outside this design.

The API request and response payloads belong to the OpenAPI entities and are not repeated in this SDD.

## Design inputs

| ID     | Required result                                                | Baseline acceptance criteria         |
| ------ | -------------------------------------------------------------- | ------------------------------------ |
| `DI-2` | Synchronize permitted steps and sleep for the intended member. | `AC-HT-004`–`AC-HT-008`, `AC-HT-013` |
| `DI-3` | Reconcile source changes and recover from interruption.        | `AC-HT-009`–`AC-HT-011`              |
| `DI-4` | Make synchronization completion and exceptions visible.        | `AC-HT-012`                          |

These are baseline design inputs. They are not risk controls.

## C2 — Containers

```mermaid
flowchart LR
    person["Person tracking family health<br/>Person"]
    source["Mobile Health Store<br/>External Software System<br/>HealthKit or Health Connect"]
    medplum["Medplum<br/>External Software System<br/>Identity, authorization, FHIR storage, and history"]

    subgraph system["Health Tracking — Software System"]
        mobile["Flutter Mobile App<br/>Container<br/>Reads permitted source changes and manages local sync state"]
        local["Local Health Store<br/>Container: encrypted on-device data store<br/>Keeps records and per-type sync progress"]
        server["Health Tracking Server<br/>Container<br/>Validates and reconciles mobile health records"]
    end

    person -->|"Selects member, grants source access, and reviews status"| mobile
    source -->|"Returns permitted step and sleep changes"| mobile
    mobile -->|"Stores local records and sync progress"| local
    mobile -->|"Synchronizes records over HTTPS with user token"| server
    server -->|"Resolves actor and commits FHIR changes with the same user token"| medplum
    server -->|"Returns per-record and overall outcomes"| mobile
```

The OS mobile health store is the source for imported records. The local store makes synchronization resumable. Medplum
is authoritative for the shared FHIR projection and applies access policy on every write.

## Responsibility boundaries

| Element                | Responsibility                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter mobile app     | Request platform permissions, select the intended member, read source changes, retain local progress, retry, and present status.        |
| Mobile health adapter  | Translate HealthKit anchors or Health Connect change tokens into source-neutral changes without merging records from different sources. |
| Local health store     | Retain source records and a separate synchronization position for each platform record type until the server acknowledges them.         |
| Health Tracking server | Authenticate the recorder, validate the command, reconcile each source record, and return explicit outcomes.                            |
| Medplum adapter        | Project accepted records to FHIR and submit them with the caller's token.                                                               |
| Medplum                | Authorize the actor, validate FHIR resources, preserve resource history, and persist accepted changes.                                  |

## C3 — Synchronization components

```mermaid
flowchart LR
    source["Mobile Health Store<br/>External System"]
    medplum["Medplum<br/>External System"]

    subgraph mobile["Flutter Mobile App — Container"]
        permissions["Permission Coordinator<br/>Component<br/>Requests only selected record types"]
        reader["Mobile Health Reader<br/>Component<br/>Reads per-type additions, changes, and deletions"]
        journal["Sync Journal<br/>Component<br/>Stores records, outcomes, and per-type positions"]
        coordinator["Sync Coordinator<br/>Component<br/>Sends pending changes and advances acknowledged positions"]
    end

    subgraph server["Health Tracking Server — Container"]
        entry["Sync Command Entry<br/>Component<br/>Receives the OpenAPI-defined command and translates outcomes"]
        actor["Actor Resolver<br/>Component<br/>Resolves the authenticated Medplum actor"]
        handler["Synchronize Mobile Health Handler<br/>Component<br/>Validates and reconciles each source record"]
        mapper["FHIR Projection Mapper<br/>Component<br/>Maps steps, sleep, source identity, and recorder provenance"]
        gateway["Health Record Gateway<br/>Component<br/>Commits FHIR changes through Medplum"]
    end

    permissions -->|"Requests read access"| source
    reader -->|"Reads changes from the last position"| source
    reader -->|"Appends source changes"| journal
    coordinator -->|"Reads pending changes"| journal
    coordinator -->|"Submits a sync command"| entry
    entry -->|"Resolves recorder"| actor
    actor -->|"Reads authenticated profile"| medplum
    entry -->|"Invokes with actor"| handler
    handler -->|"Maps accepted changes"| mapper
    mapper -->|"Requests FHIR reconciliation"| gateway
    gateway -->|"Commits with caller token"| medplum
    entry -->|"Returns outcomes"| coordinator
    coordinator -->|"Records outcomes and advances acknowledged positions"| journal
```

## Dynamic view — Incremental synchronization

```mermaid
sequenceDiagram
    participant Store as Mobile Health Store
    participant App as Flutter App
    participant Journal as Local Sync Journal
    participant Server as Health Tracking Server
    participant Medplum as Medplum

    App->>Journal: Read per-type sync position
    App->>Store: Read step or sleep changes after position
    Store-->>App: Added, changed, and deleted source records + next position
    App->>Journal: Save changes and proposed next position
    App->>Server: Submit pending changes with user token
    Server->>Medplum: Resolve authenticated actor
    Server->>Medplum: Reconcile accepted FHIR projections
    Medplum-->>Server: Per-record commit outcomes
    Server-->>App: Per-record and overall sync outcomes
    App->>Journal: Mark acknowledged records
    App->>Journal: Advance position only through acknowledged source changes
```

If the process stops before acknowledgement is stored, the client resubmits the pending change. Stable source identity
makes that replay reconciliation rather than creation of another logical record.

## Source change model

- HealthKit uses an anchor to return newly saved and deleted samples for a data type.
- Health Connect uses a change token to return upserts and deletions. A separate position is retained per record type.
- A platform position is advanced locally only after all source changes through that position have terminal server
  outcomes recorded.
- Permission-limited or absent data is not converted into a zero-valued step or sleep record.
- Revoked permission stops future reads for that type; it does not silently erase previously synchronized history.

## FHIR projection

| Mobile health concept     | Medplum FHIR representation                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Step-count interval       | `Observation` using LOINC `55423-8`, an effective period, and UCUM `{steps}`.                        |
| Sleep session             | `Observation` using LOINC `93832-4`, an effective period, and UCUM hours for total duration.         |
| Source record identity    | Stable `Observation.identifier` scoped to platform, source, record type, and source record identity. |
| Source addition or change | Create or update the same logical `Observation`; Medplum retains version history.                    |
| Source deletion           | Mark the current FHIR projection as not usable while retaining Medplum version history.              |
| Recorder and source       | `Provenance` associated with the affected `Observation`.                                             |

Sleep-stage projection is not yet selected. The design cannot claim `AC-HT-008` until a standard representation and
round-trip mapping are agreed.

## Authorization boundary

There is no service account in the synchronization path. The Flutter app sends the signed-in person's bearer token,
and the server uses the same user-scoped Medplum client to resolve the actor and persist the FHIR transaction. Medplum
remains the authorization decision point for the intended member.

Mobile OS permission and Medplum authorization answer different questions: OS permission allows the app to read a
record type from the device; Medplum authorization allows the authenticated actor to write the intended member's
record. Both decisions are required.

## Failure and recovery behavior

| Condition                                          | Design response                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Mobile health type is unavailable or not permitted | Do not read or infer records for that type; report the type as unavailable for this synchronization. |
| Source position is expired or invalid              | Re-read the permitted history for that type and reconcile it using stable source identities.         |
| One source record is invalid or not authorized     | Return a terminal outcome for that record while retaining other records for independent processing.  |
| Medplum is unavailable                             | Retain pending local changes and the previous acknowledged position for retry.                       |
| Response is lost after submission                  | Resubmit the same source changes; reconciliation must not create duplicate logical records.          |
| Synchronization is interrupted between pages       | Resume from locally retained changes and the last acknowledged per-type position.                    |

## Traceability

| Source                                            | Design input | Design output                                                  | Verification status |
| ------------------------------------------------- | ------------ | -------------------------------------------------------------- | ------------------- |
| `UN-HT-002`; `AC-HT-004`–`AC-HT-008`, `AC-HT-013` | `DI-2`       | Source reader, sync handler, and FHIR projection               | Not verified.       |
| `UN-HT-002`; `AC-HT-009`–`AC-HT-011`              | `DI-3`       | Stable source identity, sync journal, and acknowledgement rule | Not verified.       |
| `UN-HT-002`; `AC-HT-012`                          | `DI-4`       | Per-record and overall outcomes                                | Not verified.       |

## Risk-analysis boundary

Safety risks `SAF-HT-004`–`SAF-HT-008` and STRIDE threats `SEC-HT-007`–`SEC-HT-012` remain identified but unevaluated.
This SDD allocates no risk controls and makes no control-effectiveness or residual-risk claim.

## Open design questions

- Which standard FHIR representation will preserve sleep stages and their periods?
- Does a source deletion mark an Observation `entered-in-error`, use another status, or perform a FHIR delete?
- Is synchronization page-atomic or record-atomic when Medplum returns mixed outcomes?
- What history window does the product request initially and after a source position expires?
- How does the person distinguish permission-limited history from a complete but empty history without violating
  HealthKit's privacy behavior?
