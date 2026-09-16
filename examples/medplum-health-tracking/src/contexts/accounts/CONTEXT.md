# Accounts

The bounded context for associating an authenticated account with its self-member profile, creating minor member
profiles, and governing family and digitization-agent authority.

## Language

**Account**: The authenticated actor that owns family-link and agent-grant decisions. It is distinct from a member.

**Self-member**: The Patient profile representing the account holder. It is selectable without a separate family link.

**Minor profile**: A Patient created from a parent or guardian's stated relationship. It has no login or approval flow.

**Family link**: Active owner authority for one minor profile. It is complete only after Medplum confirms access.

**Agent grant**: Separate, task-limited authority for an agent and selected members. It never copies the owner's wider
access.

**Digitization task**: Permission to create a measurement from reviewed source material for a selected member.

**Identifier collision**: A match with an existing Patient that stops online creation without disclosing or linking the
Patient.

**Family unlink**: Removal of the owner's and every derivative agent's access before the family link is reported ended.
