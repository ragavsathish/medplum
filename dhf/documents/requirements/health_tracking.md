---
id: REQ-HT-001
kind: requirements
context: health-tracking
---

# Health Tracking — User Needs and Baseline Acceptance Criteria

**Status:** Draft design-review input. See the [EventStorming record](../discovery/EVENT_STORMING.md). Height, weight, steps, and sleep are measurement types, not separate domains. Alice may enter measurements herself or grant a more restricted agent to digitize them.

## Record manually

**UN-HT-001:** As Alice, I need to record wellness measurements for myself or minor Charlie so each measurement appears under the intended profile with its value, time, and recorder.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-HT-001` | Alice selects her own or Charlie's active profile before entering a measurement; the saved measurement has only that member as subject. | `DI-14` |
| `AC-HT-002` | A committed height measurement shows the selected member, value, unit, observed time, and Alice as recorder. | `DI-1` |
| `AC-HT-003` | A committed weight measurement shows the selected member, value, unit, observed time, and Alice as recorder. | `DI-2` |
| `AC-HT-004` | `Measurement Recorded` is reported only after commit is confirmed; a known refusal, failure, or unknown commit has a distinct outcome. | `DI-3` |

## Digitize a photo

**UN-HT-002:** As Alice, I need to review a measurement digitized from a photo for myself or Charlie before it is saved so the value, unit, and profile reflect what I intended.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-HT-005` | The agent presents a candidate value, unit, and selected profile alongside the source photo; no measurement is recorded yet. | `DI-15` |
| `AC-HT-006` | After Alice confirms the value, unit, and profile, a committed measurement is recorded for that profile with the agent as recorder and Alice as grantor. | `DI-15` |
| `AC-HT-007` | If Alice rejects the candidate, no measurement is saved; the original photo remains available to her for another attempt. | `DI-16` |
| `AC-HT-008` | When the digitization attempt ends, Alice retains restricted photo access and the agent no longer has photo access. | `DI-17` |

The photo retention duration and exact temporary-access design remain open. The AC state the intended behavior, not a claim that Medplum's Binary policy already enforces it.

## Import attributed mobile measurements

**UN-HT-003:** As Alice, I need my permitted mobile steps and sleep digitized automatically by my limited agent so those measurements appear in my wellness record without reviewing each structured item.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-HT-009` | Mobile source permission is granted separately from agent access; import runs only while both are active for the permitted record type. | `DI-13` |
| `AC-HT-010` | A new Alice-attributed step record is saved automatically with its count and observed period. | `DI-4`, `DI-6` |
| `AC-HT-011` | A new Alice-attributed sleep session is saved automatically with its start, end, and total duration. | `DI-5`, `DI-7` |
| `AC-HT-012` | Data from a shared device is not assigned to Charlie without a source explicitly attributed to him; this MVP imports mobile steps and sleep for Alice only. | `DI-18` |
| `AC-HT-013` | Reimporting an unchanged source record does not create another logical measurement. | `DI-9` |
| `AC-HT-014` | When the source deletes a record, the imported measurement remains and its source is marked absent; it is not automatically retracted. | `DI-10` |
| `AC-HT-015` | Alice can see that the source is absent and may retract the imported measurement herself. | `DI-19` |

How a later mobile-source correction changes an imported value is open. Sleep stages and offline capture/sync are outside this MVP slice; no AC for them is asserted here.

## Correct or retract a saved measurement

**UN-HT-004:** As Alice, I need to correct or retract a saved measurement so my family's current wellness record can be fixed without silently losing its earlier history.

| ID | Baseline acceptance criterion | Design input |
|---|---|---|
| `AC-HT-016` | A committed value correction keeps the measurement's member fixed, shows the new current value, and preserves the earlier value in history. | `DI-20` |
| `AC-HT-017` | A measurement saved under the wrong profile is retracted and recorded again for the correct profile; its subject is not transferred. | `DI-21` |
| `AC-HT-018` | A refused, failed, or unconfirmed correction is not reported as `Measurement Corrected`. | `DI-20` |

## Traceability

| User need | EventStorming outcome | AC | Design description |
|---|---|---|---|
| `UN-HT-001` | Measurement Recorded / Rejected / Unconfirmed | `AC-HT-001`–`004` | [Health Tracking SDD](../design/health_tracking.md) |
| `UN-HT-002` | Candidate Extracted / Rejected; Measurement Recorded; Agent Photo Access Ended | `AC-HT-005`–`008` | [Health Tracking SDD](../design/health_tracking.md) |
| `UN-HT-003` | Mobile Source Connected; Measurement Recorded; Source Marked Absent | `AC-HT-009`–`015` | [Mobile Import SDD](../design/mobile_health_sync.md) |
| `UN-HT-004` | Measurement Corrected / Retracted | `AC-HT-016`–`018` | [Health Tracking SDD](../design/health_tracking.md) |

Safety and STRIDE evaluation remains separate. No risk-based AC or verified control is added here.
