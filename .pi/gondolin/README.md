# Gondolin for Pi

Runs the Medplum Health Tracking stack in an isolated Linux VM.

## First setup

Requires Apple Silicon, Node.js, npm, and Pi.

```bash
npm --prefix .pi/gondolin ci
npm --prefix .pi/gondolin run image
npm --prefix .pi/gondolin run warm
```

Start Pi from the repository root:

```bash
pi
```

Pi reads `.pi/gondolin.json`, resumes the warmed checkpoint, and mounts this
repository at `/workspace`. Each session gets a fresh copy-on-write VM; files
under `/workspace` persist.

## Run tests

Inside Pi:

```bash
cd examples/medplum-health-tracking
npm run test:acceptance:stack
```

This command starts the Health Tracking acceptance stack from
`docker-compose.acceptance.yml` and writes Allure evidence to `dhf/allure-results/`.

Do not start another Gondolin VM from inside Pi.

## Configuration

`.pi/gondolin.json` contains the repository's VM settings:

```json
{
  "image": "medplum-health-tracking:alpine-3.23",
  "memory": "8G",
  "cpus": 4,
  "disk": "24G",
  "checkpoint": "~/.cache/gondolin/medplum-health-images.aarch64.qcow2",
  "policy": ".pi/gondolin-policy.json"
}
```

The network allowlist is in `.pi/gondolin-policy.json`. Environment variables
can override `GONDOLIN_IMAGE`, `GONDOLIN_MEMORY`, `GONDOLIN_CPUS`,
`GONDOLIN_DISK`, `GONDOLIN_CHECKPOINT_PATH`, and `GONDOLIN_POLICY_PATH`.

Use `/gondolin` in Pi to show the active VM details.

## Refreshing the environment

Source changes do not require a rebuild.

Refresh the checkpoint after changing `package-lock.json`, Compose images, or
Linux dependencies:

```bash
FORCE_MEDPLUM_HEALTH_CHECKPOINT=1 npm --prefix .pi/gondolin run warm
```

Rebuild the base image after changing the image config or rootfs setup:

```bash
FORCE_MEDPLUM_HEALTH_IMAGE_BUILD=1 npm --prefix .pi/gondolin run image
npm --prefix .pi/gondolin run warm
```

The root `package.json` intentionally has no Gondolin scripts. The only local
commands are `image` and `warm` under `.pi/gondolin`.
