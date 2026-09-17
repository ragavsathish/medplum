---
id: OTS-MEDPLUM-001
kind: ots-record
status: draft
reviewed_on: 2026-09-16
---

# Medplum OTS record

## Purpose

Medplum is an off-the-shelf software dependency shared by Accounts and Health Tracking. This record identifies what we rely on and the evidence still needed. It does not qualify a deployment or approve Medplum for release.

## Identification

RDM references: [[62304:8.1.2.a]] [[62304:8.1.2.b]] [[62304:8.1.2.c]]

| Item | Current evidence | Open evidence |
|---|---|---|
| Source reviewed | Commit `771a512d24b31948fcfc78dacdd6fbe36b72e416`; server and core version `5.1.37` | Correspondence to the deployed artifacts and local modifications |
| Deployment | [Compose](../../../docker-compose.acceptance.yml#L43) uses `medplum/medplum-server:latest` and `medplum/medplum-app:latest` | Immutable image digests, effective configuration, and Cloud versus self-hosted decision |
| Supporting software | PostgreSQL 16, Redis 7, package lock, and Binary storage are present in the reviewed source/configuration | Deployed runtime, operating-system packages, SBOM, backup, and storage configuration |
| Supplier | Orangebot, Inc. and Medplum contributors | Applicable support agreement, owner, response commitments, and end-of-life date |

The linked Compose file is the currently identified system configuration document. [[62304:8.1.3]] It is not evidence of the effective or qualified deployed configuration.

## Relied-on functions

- Patient and family-profile persistence.
- Observation and Provenance writes, history, and confirmed outcomes.
- Authentication, AccessPolicy enforcement, membership, and revocation.
- Restricted source-photo storage and access; the final photo mechanism remains open.

Requirements and design are in [Accounts](../requirements/accounts.md), [Health Tracking](../requirements/health_tracking.md), [Accounts SDD](../design/accounts.md), and [Health Tracking SDD](../design/health_tracking.md).

## Maintenance and support facts

- Medplum publishes [releases](https://github.com/medplum/medplum/releases), [issues](https://github.com/medplum/medplum/issues), and [security advisories](https://github.com/medplum/medplum/security).
- Its [version policy](../../../../../packages/docs/docs/compliance/versions.md) describes lockstep component versions, weekly patches, sequential minor upgrades, one active year and one maintenance year per major. A further security-only year is stated only for licensed Enterprise customers.
- Its [hosting guidance](../../../../../packages/docs/docs/self-hosting/considerations.md) assigns upgrades, infrastructure, monitoring, and on-call response to self-hosters. Medplum Cloud handles platform maintenance and upgrades.
- Public documentation is not evidence of our support agreement or operational capability.

## Risk analysis

| ID | Failure sequence | Possible effect |
|---|---|---|
| `OTS-M-01` | Artifacts change or diverge without review | Access, persistence, attribution, or history differs from the design |
| `OTS-M-02` | An advisory is missed or a patch is delayed | A known vulnerability remains reachable |
| `OTS-M-03` | An upgrade or migration fails | Writes, history, or recovery become unavailable or uncertain |
| `OTS-M-04` | Supplier or dependency support ends | Fixes become unavailable, causing exposure or interruption |
| `OTS-M-05` | Access, identity-provider, or storage configuration drifts | Agent authority expands or family data is disclosed |

| Safety ID | Source user need | Hazardous situation | Possible harm |
|---|---|---|---|
| `OTS-S-01` | `UN-HT-001`–`004` | Alice relies on incorrect wellness data | An inappropriate decision may contribute to injury |
| `OTS-S-02` | `UN-HT-001`, `003`, `004` | Alice believes missing or stale data is complete | Recognition or help-seeking may be delayed |
| `OTS-S-03` | `UN-ACC-001`, `003`, `004`; `UN-HT-001`–`004` | Alice trusts data from compromised authority | Incorrect action or privacy-related distress |

These harms remain conditional on intended use. STRIDE concerns are spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of agent privilege.

Probability, severity, acceptability, controls, and residual risk are not evaluated because the project lacks approved risk criteria and decision authority.

## License

The inspected server and core manifests declare `Apache-2.0`. The repository contains [Apache License 2.0](../../../../../LICENSE.txt) and a [NOTICE](../../../../../NOTICE).

Still required before release:

- Identify whether the product is hosted, self-hosted, or distributed.
- Inventory licenses and notices for the exact server image, client bundle, operating-system packages, and other dependencies.
- Review license changes with every Medplum or dependency update.
- Record the applicable commercial/support terms separately; Apache-2.0 provides no support commitment.

## Missing qualification evidence

- Immutable deployed baseline and SBOM.
- Current defect and vulnerability-applicability record.
- Named maintenance/security owner and monitoring process.
- Support/EOL agreement and discontinuation plan.
- Upgrade, migration, backup, restore, and rollback evidence.
- Regression results tied to the exact deployed artifact and configuration.

## Periodic review

Update one Git-versioned review. Capture the baseline, support status, vulnerabilities, reachability, fixability, license changes, evidence, and follow-up. Git history preserves earlier reviews.

Current review: [Medplum OTS review](medplum_ots_review.md).
