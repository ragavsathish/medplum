---
id: SDD-HT-001
kind: design
context: health-tracking
satisfies:
  - UN-HT-001
design_inputs:
  - id: DI-1
    text: >-
      The Health Tracking server shall record a valid height measurement as a
      FHIR Observation with recorder Provenance for the intended member and
      shall report Measurement Recorded only after both resources are committed.
    traces_to:
      - UN-HT-001
  - id: DI-2
    text: >-
      The Health Tracking server shall record a valid weight measurement as a
      FHIR Observation with recorder Provenance for the intended member and
      shall report Measurement Recorded only after both resources are committed.
    traces_to:
      - UN-HT-001
  - id: DI-3
    text: >-
      The Health Tracking server shall not report Measurement Recorded when
      commit is unconfirmed and shall report the rejected, failed, or
      unconfirmed outcome corresponding to the known result.
    traces_to:
      - UN-HT-001
---

# Health Tracking — Software Design Description

**Status:** Draft.

## Purpose and scope

**Audience:** Developers and design reviewers.

**Decision supported:** Understand and review the responsibility boundaries
for recording a member's height or weight through Medplum.

**Software system in scope:** The server-side Health Tracking system.

The design covers the synchronous write path from an incoming request to a
FHIR `Observation` and its `Provenance`. It includes command validation,
current-actor resolution, FHIR mapping, persistence using the caller's bearer
token, and selection of the resulting domain event.

The Flutter client, offline synchronization, measurement-history reads, BMI,
daily steps, sleep, climate capture, Medplum `AccessPolicy` configuration, and
deployment topology are outside this SDD.

## Domain boundary

Health Tracking is the single bounded context in scope. It owns measurement
commands, rules, events, and caller-facing outcomes. Identity and access is an
external capability. The Medplum FHIR repository is a platform seam, not a
second bounded context.

## Design input

| ID     | Traces to   | Required result                                       | Baseline acceptance criterion |
| ------ | ----------- | ----------------------------------------------------- | ----------------------------- |
| `DI-1` | `UN-HT-001` | Record a height Observation and recorder Provenance.  | `AC-HT-001`                   |
| `DI-2` | `UN-HT-001` | Record a weight Observation and recorder Provenance.  | `AC-HT-002`                   |
| `DI-3` | `UN-HT-001` | Return the outcome supported by the confirmed result. | `AC-HT-003`                   |

`DI-1`–`DI-3` are derived from the baseline user need. They are not risk-control requirements.

The request and response payloads are defined by the OpenAPI entities and are
not repeated in this SDD.

## Design outputs

| Design element              | Responsibility                                                          |
| --------------------------- | ----------------------------------------------------------------------- |
| Measurement command entry   | Receive a measurement command and translate its outcome                 |
| Actor resolver              | Resolve the authenticated Medplum actor from the caller's bearer token  |
| Record Measurement handler  | Validate the command, request persistence, and select the result event  |
| Measurement model           | Define valid height and weight measurements and their domain vocabulary |
| Health record gateway       | Isolate Health Tracking from Medplum persistence details                |
| Medplum FHIR mapper         | Map the measurement and actor to `Observation` and `Provenance`         |
| Medplum persistence adapter | Commit the FHIR resources atomically using the caller's token           |

## C3 — Health Tracking server components

This component view zooms into the Health Tracking server container. The
client and Medplum are outside that container.

```mermaid
flowchart TB
    client["Health Tracking Client<br/>External Container<br/>Collects the member and measurement"]
    medplum["Medplum FHIR Service<br/>External Software System<br/>Identity, authorization, and FHIR persistence"]

    subgraph server["Health Tracking Server"]
        http["Measurement Command Entry<br/>Component<br/>Receives commands and translates outcomes"]
        identity["Actor Resolver<br/>Component<br/>Resolves the current Medplum actor"]
        application["Record Measurement Command Handler<br/>Component<br/>Validates, persists, and selects the resulting event"]
        domain["Measurement Domain<br/>Component<br/>Defines measurement validity rules and event vocabulary"]
        repository["Health Record Gateway<br/>Component<br/>Isolates Medplum persistence"]
        mapper["Medplum FHIR Mapper<br/>Component<br/>Creates Observation and Provenance resources"]
    end

    client -->|"Submits measurement and bearer token over HTTPS"| http
    http -->|"Resolves the current actor"| identity
    identity -->|"Reads the authenticated profile using FHIR API"| medplum
    http -->|"Invokes with command and authenticated actor"| application
    application -->|"Applies measurement rules and creates result event"| domain
    application -->|"Requests measurement persistence"| repository
    repository -->|"Maps domain data to FHIR resources"| mapper
    repository -->|"Executes FHIR transaction using caller token"| medplum
```

### Component responsibilities

- The HTTP adapter owns transport concerns and composition. It does not make
  domain decisions.
- The command handler receives an authenticated actor and owns the complete
  record-measurement use case.
- The domain component contains no identity, authorization, Medplum, or FHIR
  concerns.
- The Medplum persistence adapter uses the same caller token for profile
  resolution and persistence. Medplum remains the authorization decision point.
- The FHIR mapper isolates healthcare representation from the domain model.

## Dynamic view — Record Measurement

```mermaid
sequenceDiagram
    participant Client as Health Tracking Client
    participant HTTP as HTTP Adapter
    participant Identity as Medplum Identity Adapter
    participant Handler as Record Measurement Handler
    participant Repository as Medplum Health Repository
    participant Medplum as Medplum FHIR Service

    Client->>HTTP: POST /measurements + bearer token
    HTTP->>Identity: Resolve current actor
    Identity->>Medplum: Read authenticated profile
    Medplum-->>Identity: Patient, RelatedPerson, or Practitioner
    HTTP->>Handler: Handle command with actor
    Handler->>Handler: Validate measurement

    alt Invalid command
        Handler-->>HTTP: Measurement Rejected
    else Valid command
        Handler->>Repository: Save measurement and actor
        Repository->>Medplum: FHIR transaction: Observation + Provenance
        alt Commit confirmed
            Medplum-->>Repository: Transaction response
            Repository-->>Handler: Persistence confirmed
            Handler-->>HTTP: Measurement Recorded
        else Commit explicitly refused or failed
            Medplum-->>Repository: OperationOutcome
            Repository-->>Handler: Typed failure reason
            Handler-->>HTTP: Rejected or failed event
        else Transport outcome uncertain
            Repository-->>Handler: Outcome unknown
            Handler-->>HTTP: Measurement Recording Unconfirmed
        end
    end
```

`Measurement Recorded` occurs only after the FHIR transaction is confirmed.

## Domain-to-FHIR mapping

| Domain concept         | FHIR representation                                                             |
| ---------------------- | ------------------------------------------------------------------------------- |
| Measurement identifier | Medplum UUID stored as `Observation.id`                                         |
| Intended member        | Medplum UUID stored in `Observation.subject.reference` as a `Patient` reference |
| Observation time       | `Observation.effectiveDateTime` and `Provenance.occurredDateTime`               |
| Height measurement     | Body Height profile and LOINC `8302-2`                                          |
| Weight measurement     | Body Weight profile and LOINC `29463-7`                                         |
| Value and unit         | `Observation.valueQuantity`, with UCUM coding                                   |
| Authenticated actor    | `Provenance.agent.who`                                                          |

The repository writes the `Observation` and `Provenance` in one FHIR
transaction. The `Observation` uses `PUT Observation/{id}`. The `Provenance`
uses a conditional create keyed by the target observation.

## Authorization boundary

There is no service account in this path. The HTTP adapter extracts the
caller's bearer token, creates a user-scoped `MedplumClient`, and resolves the
current actor from the same client. The repository sends the FHIR transaction
with that client. Medplum evaluates its configured access policy. A Medplum
`403` outcome becomes a `Measurement Rejected` outcome with the reason
`Not Permitted`.

This describes existing behavior. It is not evidence that any identified
safety or STRIDE risk is controlled.

## Error behavior

| Condition                            | Command outcome / HTTP response                                   |
| ------------------------------------ | ----------------------------------------------------------------- |
| Bearer token absent or malformed     | HTTP `401` with a FHIR `OperationOutcome`; command not invoked    |
| Request body is not valid JSON       | HTTP `400`; command not invoked                                   |
| Current actor unavailable            | HTTP `401` with a FHIR `OperationOutcome`; command not invoked    |
| Measurement command or UUID invalid  | `Measurement Rejected / Invalid Measurement`; HTTP `400`          |
| Medplum denies persistence           | `Measurement Rejected / Not Permitted`; HTTP `403`                |
| Medplum rejects FHIR validation      | `Measurement Rejected / Invalid Measurement`; HTTP `400`          |
| Medplum reports `429` or `5xx`       | `Measurement Recording Failed / Record Unavailable`; HTTP `503`   |
| Transport outcome is unknown         | `Measurement Recording Unconfirmed / Outcome Unknown`; HTTP `503` |
| Persistence succeeds                 | `Measurement Recorded`; HTTP `201`                                |
| Other FHIR `OperationOutcome` status | Passed through by the HTTP adapter                                |

## Verification and traceability

| Source                   | Design input | Design output                          | Verification status                        |
| ------------------------ | ------------ | -------------------------------------- | ------------------------------------------ |
| `UN-HT-001`; `AC-HT-001` | `DI-1`       | Height Observation and Provenance      | Not verified in this design-only revision. |
| `UN-HT-001`; `AC-HT-002` | `DI-2`       | Weight Observation and Provenance      | Not verified in this design-only revision. |
| `UN-HT-001`; `AC-HT-003` | `DI-3`       | Typed command and persistence outcomes | Not verified in this design-only revision. |
| EventStorming outcomes   | —            | Domain outcome vocabulary              | Not verified in this design-only revision. |

Acceptance evidence and independent review are required before this design can
be claimed as verified.

## Risk-analysis boundary

Safety risks `SAF-HT-001`–`SAF-HT-003` and STRIDE threats
`SEC-HT-001`–`SEC-HT-006` remain identified but unevaluated. The approved
risk matrices and acceptability criteria are missing. Consequently, this SDD
allocates no risk-control requirements and makes no control-effectiveness or
residual-risk claim.

## Assumptions and open questions

- A deployment configuration must start and manage the Health Tracking server.
- The client and API contract for selecting the intended family member remain
  outside this document.
- The current command contract includes the intended member identifier, while
  the EventStorming model says the active member comes from context. This
  mismatch must be resolved before the design is baselined.
- The Medplum project must define the applicable access policy; this example
  does not create one.
- An independent faithfulness review of the acceptance evidence is still
  required.
