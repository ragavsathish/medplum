# Health Tracking

The bounded context for recording, correcting, and interpreting health and wellness measurements for one or more
members.

## Language

**Member**:

A person whose health measurements are tracked. Each member has their own identity and measurements, even when
another family member records them.

**Measurement**:

A value observed about one member at a defined time or over a defined period.

**Measurement recorded**:

A measurement that has been successfully committed to the member's authoritative health record. Validation or local
capture alone does not make the measurement recorded.

**Measurement rejected**:

A requested measurement that was not committed because the measurement was invalid or the recorder was not permitted.

**Measurement recording failed**:

A requested measurement that was not committed because the authoritative health record reported a technical failure.

**Measurement recording unconfirmed**:

A requested measurement whose commit status is unknown because no authoritative outcome was received. It must be
verified before retrying.

**Recorder**:

A member, family caregiver, or practitioner permitted to submit a measurement for a member. Family membership alone
does not make someone a permitted recorder.

**Active member**:

The member whose health record is in context for the recording task. Measurement details do not select or change the
active member.

**Measurement correction**:

A change to a previously recorded measurement that becomes current while the original remains available in history.
_Avoid_: Silent overwrite, deletion

**Climate observation**:

An environmental measurement associated with a place and time. It provides context for a member's health data but is
not itself a measurement of the member.

**Daily health capture**:

A group of activity, sleep, and environmental measurements recorded together for one member.

**Climate exposure**:

A clinically assessed environmental exposure affecting a member. It is distinct from the environmental measurements
used as evidence for the assessment.

**Family**:

A group of members who may share health-tracking activities and environmental context. Membership does not imply
permission to view or change another member's health data.
