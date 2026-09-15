---
id: REQ-HT-001
kind: requirements
context: health-tracking
---

# Health Tracking Requirements

**Status:** Draft.

The baseline events and commands are recorded in
[EVENT_STORMING.md](../../../examples/medplum-health-tracking/src/contexts/health-tracking/EVENT_STORMING.md).

**Measurement is the common health fact.** Height, weight, step counts, and sleep sessions are phased examples, not
separate record domains. A person may handle a measurement directly or delegate digitization to an agent. The agent
uses the same measurement events but has a narrower grant, defined in [Accounts requirements](./accounts.md).

## Record measurements

**UN-HT-001:** A person managing family health needs measurements recorded for an intended member, either directly or
by a permitted agent, so the member's health record shows the measurements and who submitted them.

The first direct-submission increment covers height and weight. Other measurement types and source reconciliation
refine this need without changing the meaning of `Measurement Recorded`.

## Baseline acceptance criteria

| ID          | Acceptance criterion                                                                                                                                                                                                                                                                                                                              | Design input |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `AC-HT-001` | Given a permitted person or agent and an intended member, a valid committed height measurement shows that member, value, unit, observed time, and recorder. `Measurement Recorded` is reported only after the commit is confirmed. | `DI-1`       |
| `AC-HT-002` | Given a permitted person or agent and an intended member, a valid committed weight measurement shows that member, value, unit, observed time, and recorder. `Measurement Recorded` is reported only after the commit is confirmed. | `DI-2`       |
| `AC-HT-003` | When a Record Measurement request is not confirmed as committed, the service does not return `Measurement Recorded`; it returns `Measurement Rejected`, `Measurement Recording Failed`, or `Measurement Recording Unconfirmed` according to the known outcome.                                                                                    | `DI-3`       |

These criteria are derived directly from `UN-HT-001`. No risk-derived acceptance criterion is included.

### Safety analysis

| ID | Hazardous sequence | Hazardous situation | Possible harm | Status |
| --- | --- | --- | --- | --- |
| `SAF-HT-001` | A measurement is associated with the wrong member. | Another person's measurement is used in the intended member's record. | Incorrect assessment or care. | Identified; not yet evaluated. |
| `SAF-HT-002` | Value, unit, or observed time is recorded incorrectly. | The record presents a misleading measurement. | Incorrect assessment or care. | Identified; not yet evaluated. |
| `SAF-HT-003` | A failed or uncertain write is reported as recorded. | A person or clinician relies on a measurement that is absent or unconfirmed. | Delayed or incorrect assessment or care. | Identified; not yet evaluated. |

### STRIDE analysis

| ID | Category | Threat | Related safety risk | Status |
| --- | --- | --- | --- | --- |
| `SEC-HT-001` | Spoofing | A recorder is represented as another person. | `SAF-HT-001` | Identified; not yet evaluated. |
| `SEC-HT-002` | Tampering | Measurement content or member association is altered. | `SAF-HT-001`, `SAF-HT-002` | Identified; not yet evaluated. |
| `SEC-HT-003` | Repudiation | Who recorded a measurement cannot be established. | None identified. | Identified; not yet evaluated. |
| `SEC-HT-004` | Information disclosure | A measurement is exposed to an unintended person. | None identified. | Identified; not yet evaluated. |
| `SEC-HT-005` | Denial of service | Recording is prevented or repeatedly interrupted. | `SAF-HT-003` | Identified; not yet evaluated. |
| `SEC-HT-006` | Elevation of privilege | A recorder gains access to write for an unintended member. | `SAF-HT-001` | Identified; not yet evaluated. |

## Reconcile source measurements

**UN-HT-002:** A person managing family health needs permitted source measurements kept current for the intended
member, whether reconciled by themselves or a permitted agent, so the member's health record reflects source changes.

The first source-reconciliation increment uses mobile step-count and sleep measurements. It is a measurement workflow,
not a separate mobile health record domain.

### Baseline acceptance criteria

| ID          | Acceptance criterion                                                                                                                                | Design input |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `AC-HT-004` | Given a permitted person or agent, intended member, and step-count source data, a new committed step-count measurement is recorded for that member and yields `Measurement Recorded`. | `DI-4`       |
| `AC-HT-005` | Given a permitted person or agent, intended member, and sleep source data, a new committed sleep measurement is recorded for that member and yields `Measurement Recorded`. | `DI-5`       |
| `AC-HT-006` | A synchronized step-count record retains its count and observed period.                                                                             | `DI-6`       |
| `AC-HT-007` | A synchronized sleep session retains its observed period and total duration.                                                                        | `DI-7`       |
| `AC-HT-008` | When a source provides sleep stages, each synchronized stage retains its type and observed period.                                                  | `DI-8`       |
| `AC-HT-009` | Repeating synchronization for an unchanged source record creates neither another measurement nor another `Measurement Recorded` outcome.             | `DI-9`       |
| `AC-HT-010` | A later synchronization yields `Measurement Recorded` for a new source measurement, `Measurement Corrected` for a changed one, or `Source Record Retracted` for a committed source deletion; prior values remain in history. | `DI-10` |
| `AC-HT-011` | An interrupted or incomplete synchronization can continue without losing accepted records or duplicating unchanged records.                         | `DI-11`      |
| `AC-HT-012` | The user can determine whether `Synchronization Completed` occurred and which available source records were not synchronized. Completion requires a known outcome for every available change. | `DI-12` |
| `AC-HT-013` | Synchronization is limited to the record types and history made available by the person's mobile health permissions.                                | `DI-13`      |

These criteria are derived directly from `UN-HT-002`. No risk-derived acceptance criterion is included.

### Safety analysis

| ID           | Hazardous sequence                                                                                                         | Hazardous situation                                                                         | Harm                                                     | Status                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| `SAF-HT-004` | Mobile health records are selected for one member but synchronized to another member.                                      | Step or sleep records belonging to one person appear in another person's health record.     | Incorrect assessment, advice, or care for either person. | Identified; not yet evaluated. |
| `SAF-HT-005` | Step intervals overlap or are aggregated incorrectly, or sleep periods and stages are transformed incorrectly.             | The health record presents misleading activity or sleep information.                        | Incorrect assessment, advice, or care.                   | Identified; not yet evaluated. |
| `SAF-HT-006` | Synchronization is interrupted, repeated, or resumed without correctly accounting for accepted records and source changes. | The health record contains missing, stale, or duplicated step or sleep records.             | Delayed or incorrect assessment, advice, or care.        | Identified; not yet evaluated. |
| `SAF-HT-007` | Permission-limited, unavailable, or missing source data is interpreted as a zero value or a complete history.              | The health record misleadingly indicates inactivity, no sleep, or complete source coverage. | Incorrect assessment, advice, or care.                   | Identified; not yet evaluated. |
| `SAF-HT-008` | A changed or deleted source record remains current in the health record without qualification.                             | A superseded or withdrawn step or sleep record is used as though it were current.           | Incorrect assessment, advice, or care.                   | Identified; not yet evaluated. |

### STRIDE analysis

| ID           | Category               | Threat                                                                                                           | Related safety risk                      | Status                         |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| `SEC-HT-007` | Spoofing               | A source, device, or recorder is represented as another trusted source, device, or person.                       | `SAF-HT-004`, `SAF-HT-005`               | Identified; not yet evaluated. |
| `SEC-HT-008` | Tampering              | A record, member association, source identifier, sync position, or synchronization outcome is altered.           | `SAF-HT-004`–`SAF-HT-006`, `SAF-HT-008`  | Identified; not yet evaluated. |
| `SEC-HT-009` | Repudiation            | The source and synchronization history of a step or sleep record cannot be established.                          | `SAF-HT-005`, `SAF-HT-006`, `SAF-HT-008` | Identified; not yet evaluated. |
| `SEC-HT-010` | Information disclosure | Mobile health data or synchronization status is exposed to a person not permitted to access the intended member. | None identified.                         | Identified; not yet evaluated. |
| `SEC-HT-011` | Denial of service      | Synchronization is prevented or repeatedly interrupted.                                                          | `SAF-HT-006`, `SAF-HT-008`               | Identified; not yet evaluated. |
| `SEC-HT-012` | Elevation of privilege | A person or client gains permission to synchronize data for another member or an unapproved record type.         | `SAF-HT-004`, `SAF-HT-005`               | Identified; not yet evaluated. |

### Phased scope

HealthKit and Health Connect expose broader groups of measurements, including activity and workouts, body
measurements, sleep, vital signs, nutrition and hydration, cycle tracking, and wellbeing. The first source increment
is limited to step counts and sleep sessions. Other types require later acceptance criteria and design inputs; this
draft does not claim they are supported.

Primary platform references:

- [Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types)
- [Apple HealthKit anchored changes](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [Android Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- [Android Health Connect synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)

## Correct a measurement

**UN-HT-003:** A person authorized for the intended member needs to correct a recorded measurement so the current
value is accurate while the earlier value remains in history.

### Baseline acceptance criteria

| ID | Acceptance criterion | Design input |
| --- | --- | --- |
| `AC-HT-014` | Given a person permitted to correct an existing measurement, when a valid correction is committed, the current measurement reflects the correction, its earlier value remains in history, and `Measurement Corrected` is reported. | Pending |
| `AC-HT-015` | When the correction is refused, fails, or has an uncertain commit outcome, `Measurement Corrected` is not reported as confirmed; the corresponding correction outcome is reported. | Pending |

These are baseline criteria from `UN-HT-003`, not risk-derived criteria. The correction command and design input are
not yet implemented or allocated.

### Safety analysis

| ID | Hazardous sequence | Hazardous situation | Possible harm | Status |
| --- | --- | --- | --- | --- |
| `SAF-HT-009` | A correction is associated with the wrong member or measurement. | The wrong measurement is presented as current. | Incorrect assessment or care. | Identified; not yet evaluated. |
| `SAF-HT-010` | An earlier value is lost or an unconfirmed change is shown as current. | Misleading history or current data is used. | Incorrect assessment or care. | Identified; not yet evaluated. |

### STRIDE analysis

| ID | Category | Threat | Related safety risk | Status |
| --- | --- | --- | --- | --- |
| `SEC-HT-013` | Tampering | A correction value or its member association is altered. | `SAF-HT-009`, `SAF-HT-010` | Identified; not yet evaluated. |
| `SEC-HT-014` | Elevation of privilege | A person gains permission to correct an unintended member's measurement. | `SAF-HT-009` | Identified; not yet evaluated. |

## Traceability

| User need | Event-storming outcomes | Baseline acceptance criteria | Design inputs |
| --- | --- | --- | --- |
| `UN-HT-001` | `Measurement Recorded`; recording refusal/failure/uncertainty | `AC-HT-001`–`AC-HT-003` | `DI-1`–`DI-3` in `SDD-HT-001`; agent access allocation pending |
| `UN-HT-002` | `Measurement Recorded`, `Measurement Corrected`, `Source Record Retracted`, `Synchronization Completed` | `AC-HT-004`–`AC-HT-013` | `DI-4`–`DI-13` in `SDD-HT-002`; agent access allocation pending |
| `UN-HT-003` | `Measurement Corrected`; correction refusal/failure/uncertainty | `AC-HT-014`–`AC-HT-015` | Pending |

## Risk gate

The project does not yet contain approved safety or security risk-acceptability criteria. Identified risks for these
user needs have therefore not been evaluated. No controls, control-effectiveness evidence, residual-risk decisions, or
risk-derived acceptance criteria are claimed.
