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

## Traceability

| User need   | Acceptance criteria     | Design input           |
| ----------- | ----------------------- | ---------------------- |
| `UN-HT-001` | `AC-HT-001`–`AC-HT-003` | `DI-1` in `SDD-HT-001` |

## Risk gate

Safety risks and STRIDE threats are identified in the design, but the project does not yet contain approved risk
acceptability criteria or control-effectiveness evidence. Risk-derived acceptance criteria remain blocked at that gate.
