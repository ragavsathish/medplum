---
id: REQ-HT-001
kind: requirements
context: health-tracking
---

# Health Tracking Requirements

**Status:** Draft.

## User need

**UN-HT-001:** A permitted recorder needs to record a member's height or weight so that the intended member's
authoritative health record contains the measurement identity, value, unit, and observation time.

## Baseline acceptance criteria

| ID          | Acceptance criterion                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-HT-001` | Given a permitted recorder and an intended member, when the recorder submits a valid height measurement, the authoritative record contains a height Observation and its recorder Provenance with the submitted identifier, member, value, unit, and observation time. `Measurement Recorded` is returned only after both resources are committed. |
| `AC-HT-002` | Given a permitted recorder and an intended member, when the recorder submits a valid weight measurement, the authoritative record contains a weight Observation and its recorder Provenance with the submitted identifier, member, value, unit, and observation time. `Measurement Recorded` is returned only after both resources are committed. |
| `AC-HT-003` | When a Record Measurement request is not confirmed as committed, the service does not return `Measurement Recorded`; it returns `Measurement Rejected`, `Measurement Recording Failed`, or `Measurement Recording Unconfirmed` according to the known outcome.                                                                                    |

These criteria are derived directly from `UN-HT-001`. No risk-derived acceptance criterion is included.

## Synchronize mobile health data

**UN-HT-002:** A person tracking family health needs to synchronize permitted mobile health data for the intended
member so that the member's health record reflects the data available from their connected device, starting with step
count and sleep.

### Baseline acceptance criteria

| ID          | Acceptance criterion                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-HT-004` | Given an intended member and permitted step-count data, synchronization records the step count for that member.                                     |
| `AC-HT-005` | Given an intended member and permitted sleep data, synchronization records the sleep session for that member.                                       |
| `AC-HT-006` | A synchronized step-count record retains its count and observed period.                                                                             |
| `AC-HT-007` | A synchronized sleep session retains its observed period and total duration.                                                                        |
| `AC-HT-008` | When a source provides sleep stages, each synchronized stage retains its type and observed period.                                                  |
| `AC-HT-009` | Repeating synchronization does not create another record for an unchanged source record.                                                            |
| `AC-HT-010` | A later synchronization reflects available source additions and changes, and a source record reported as deleted is no longer presented as current. |
| `AC-HT-011` | An interrupted or incomplete synchronization can continue without losing accepted records or duplicating unchanged records.                         |
| `AC-HT-012` | The user can determine whether synchronization completed and whether any records were not synchronized.                                             |
| `AC-HT-013` | Synchronization is limited to the record types and history made available by the person's mobile health permissions.                                |

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

HealthKit and Health Connect expose broader groups of mobile health records, including activity and workouts, body
measurements, sleep, vital signs, nutrition and hydration, cycle tracking, and wellbeing. The first increment is
limited to step-count records and sleep sessions. Other record types require later user needs; they are not implied to
be supported by `UN-HT-002`.

Primary platform references:

- [Apple HealthKit data types](https://developer.apple.com/documentation/healthkit/data-types)
- [Apple HealthKit anchored changes](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [Android Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- [Android Health Connect synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data)

## Traceability

| User need   | Acceptance criteria     | Design input           |
| ----------- | ----------------------- | ---------------------- |
| `UN-HT-001` | `AC-HT-001`–`AC-HT-003` | `DI-1` in `SDD-HT-001` |
| `UN-HT-002` | `AC-HT-004`–`AC-HT-013` | Not yet allocated      |

## Risk gate

The project does not yet contain approved safety or security risk-acceptability criteria. Identified risks for both
user needs have therefore not been evaluated. No controls, control-effectiveness evidence, residual-risk decisions, or
risk-derived acceptance criteria are claimed.
