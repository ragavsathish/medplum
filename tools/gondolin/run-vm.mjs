import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpHooks, RealFSProvider, VM, VmCheckpoint } from '@earendil-works/gondolin';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, '../..');
const workspace = path.resolve(process.env.MEDPLUM_HEALTH_WORKSPACE ?? repositoryRoot);
const imageRef = process.env.MEDPLUM_HEALTH_GONDOLIN_IMAGE ?? 'medplum-health-tracking:alpine-3.23';
const checkpointPath = process.env.MEDPLUM_HEALTH_CHECKPOINT
  ? path.resolve(process.env.MEDPLUM_HEALTH_CHECKPOINT)
  : undefined;

if (!fs.existsSync(path.join(workspace, 'docker-compose.full-stack.yml'))) {
  throw new Error(`No Medplum Compose checkout found at ${workspace}`);
}
if (checkpointPath && !fs.existsSync(checkpointPath)) {
  throw new Error(`Gondolin checkpoint does not exist: ${checkpointPath}`);
}

const { httpHooks, env } = createHttpHooks({
  allowedHosts: [
    '*.docker.com',
    '*.docker.io',
    '*.quay.io',
    'dl-cdn.alpinelinux.org',
    'quay.io',
    'registry.npmjs.org',
  ],
});

const vmOptions = {
  sessionLabel: `medplum-health ${path.basename(workspace)}`,
  sandbox: {
    imagePath: imageRef,
    netEnabled: true,
  },
  memory: process.env.MEDPLUM_HEALTH_VM_MEMORY ?? '8G',
  cpus: Number(process.env.MEDPLUM_HEALTH_VM_CPUS ?? '4'),
  rootfs: {
    mode: 'cow',
    size: process.env.MEDPLUM_HEALTH_VM_DISK ?? '24G',
  },
  httpHooks,
  env,
  allowWebSockets: false,
  vfs: {
    mounts: {
      '/workspace': new RealFSProvider(workspace),
    },
  },
};

const vm = checkpointPath
  ? await VmCheckpoint.load(checkpointPath).resume(vmOptions)
  : await VM.create(vmOptions);

async function waitForDocker() {
  for (let attempt = 1; attempt <= 60; attempt++) {
    const result = await vm.exec(['/bin/bash', '-lc', 'docker info >/dev/null 2>&1']);
    if (result.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const logs = await vm.exec(['/bin/bash', '-lc', 'tail -n 200 /var/log/dockerd.log 2>/dev/null || true']);
  throw new Error(`Docker did not become ready inside Gondolin:\n${logs.stdout}${logs.stderr}`);
}

try {
  await waitForDocker();
  const versions = await vm.exec([
    '/bin/bash',
    '-lc',
    'printf "Node "; node --version; printf "Docker "; docker --version; docker compose version',
  ]);
  process.stdout.write(versions.stdout);
  process.stderr.write(versions.stderr);
  process.stdout.write(`Workspace: ${workspace} -> /workspace\n`);
  if (checkpointPath) process.stdout.write(`Resumed checkpoint: ${checkpointPath}\n`);
  process.stdout.write('No guest or container port is forwarded to the host.\n');

  const result = await vm.shell({ cwd: '/workspace' });
  process.exitCode = result.exitCode;
} finally {
  await vm.close();
}
