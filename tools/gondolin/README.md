# Health Tracking Gondolin environment

Runs the Medplum Health Tracking Compose stack inside an isolated Linux VM.
No VM or container ports are exposed to the host.

## Requirements

- Apple Silicon/aarch64
- Node.js and npm on the host

Gondolin is a local npm dependency, not a required global install. Install it
and the launcher dependencies with:

```bash
npm run env:health:install
```

## Setup

Run these once from the repository root:

```bash
# Build the Linux image with Node, Docker, and Compose.
npm run env:health:image

# Run Linux npm ci and cache the Compose images.
npm run env:health:warm
```

Start a fresh copy-on-write VM:

```bash
npm run env:health:vm
```

Inside the VM, start the application stack:

```bash
docker compose up -d --wait --pull never
```

## Dependency cache

`env:health:warm` installs the repository's Linux `node_modules` and stores
them in the warm checkpoint. The cache is mounted only when its
`package-lock.json` hash matches the current worktree.

Refresh the cache after changing the lockfile:

```bash
FORCE_MEDPLUM_HEALTH_CHECKPOINT=1 npm run env:health:warm
```

Use another worktree with:

```bash
MEDPLUM_HEALTH_WORKSPACE=/path/to/worktree npm run env:health:warm
MEDPLUM_HEALTH_WORKSPACE=/path/to/worktree npm run env:health:vm
```

Use a separate `MEDPLUM_HEALTH_CHECKPOINT_PATH` when parallel worktrees have
different lockfiles.

## Isolation

The checkpoint retains Docker images and Linux dependencies, but no containers
or application data volumes. Every launch gets a fresh copy-on-write VM, Docker
network, and volume state.
