# Health Tracking Gondolin environment

This tool creates an isolated, Docker-capable Linux VM for the Medplum Health
Tracking environment. The current Medplum worktree is mounted at `/workspace`.
Docker and Compose run inside the VM; no guest or container port is forwarded
to the host by default.

## Install and build

From the repository root:

```bash
npm run env:health:install
npm run env:health:image
```

The image is tagged `medplum-health-tracking:alpine-3.23` and contains Node 24,
npm, Git, Docker, Docker Compose, cgroup v2 support, and OverlayFS support.

## Start the VM

```bash
npm run env:health:vm
```

Inside the VM:

```bash
docker compose -f docker-compose.full-stack.yml config --services
docker compose -f docker-compose.full-stack.yml up -d
```

The default VM has 8 GB RAM, four CPUs, and a 24 GB copy-on-write root disk.
Override these using `MEDPLUM_HEALTH_VM_MEMORY`, `MEDPLUM_HEALTH_VM_CPUS`, and
`MEDPLUM_HEALTH_VM_DISK`.

## Image-only warm checkpoint

To cache Docker images without retaining containers or volumes, start a clean
VM and run only:

```bash
docker compose -f docker-compose.full-stack.yml pull
docker container ls -a
docker volume ls
```

From another host terminal, find and snapshot the running VM:

```bash
tools/gondolin/node_modules/.bin/gondolin list
tools/gondolin/node_modules/.bin/gondolin snapshot VM_ID \
  --output "$HOME/.cache/gondolin/medplum-health-images.qcow2"
```

Resume that immutable baseline in the current worktree:

```bash
MEDPLUM_HEALTH_CHECKPOINT="$HOME/.cache/gondolin/medplum-health-images.qcow2" \
  npm run env:health:vm
```

Then create fresh containers and volumes from the cached images:

```bash
docker compose -f docker-compose.full-stack.yml up -d --pull never
```
