# Accounts

The bounded context for associating an authenticated account with its self-member profile, creating minor member
profiles, and governing family and digitization-agent authority.

## Language

**Account**: The authenticated actor that owns family-link and agent-grant decisions. It is distinct from a member.

**Self-member**: The member profile representing the account holder. It is selectable without a separate family link.

**Minor profile**: A Patient created from a parent or guardian's stated relationship. It has no login or approval flow.

**Family link**: Active owner authority for one minor profile. It is complete only after that authority is confirmed.

**Digitization agent**: The non-human Medplum Bot that performs authorized digitization work.

**Agent grant**: Separate, task-limited authority for the Digitization Bot and selected members. It exists only when
the account owner grants it and never copies the owner's wider access.

**Digitization task**: Permission for the Digitization Bot to process measurement source material for a selected
member. For a photo, the Bot proposes a candidate and does not confirm it as the owner.

**Identifier collision**: A match with an existing member record that stops online creation without disclosing or
linking that record.

**Family unlink**: Removal of the owner's and every derivative Bot grant before the family link is reported ended.
