import {
  createVm,
  prepareKeycloakRealm,
  prepareNodeModulesCache,
  resolveCheckpointForStartup,
  validateWorkspace,
  waitForDocker,
  workspace,
} from "./vm-support.mjs";

validateWorkspace();

const checkpointPath = resolveCheckpointForStartup();
const vm = await createVm({ checkpointPath });

try {
  await waitForDocker(vm);
  const nodeModulesCache = await prepareNodeModulesCache(vm);
  const keycloakPrepared = await prepareKeycloakRealm(vm);
  const versions = await vm.exec([
    "/bin/bash",
    "-lc",
    'printf "Node "; node --version; printf "Docker "; docker --version; docker compose version',
  ]);
  process.stdout.write(versions.stdout);
  process.stderr.write(versions.stderr);
  process.stdout.write(`Workspace: ${workspace} -> /workspace\n`);
  if (checkpointPath)
    process.stdout.write(`Resumed checkpoint: ${checkpointPath}\n`);
  if (nodeModulesCache.status === "mounted") {
    process.stdout.write(
      `Mounted cached node_modules at ${nodeModulesCache.count} workspace locations.\n`,
    );
  } else if (checkpointPath && nodeModulesCache.status === "stale") {
    process.stdout.write(
      "The checkpoint node_modules cache does not match package-lock.json; cache not mounted.\n",
    );
    process.stdout.write(
      "Refresh it with FORCE_MEDPLUM_HEALTH_CHECKPOINT=1 npm run env:health:warm.\n",
    );
  }
  if (keycloakPrepared)
    process.stdout.write("Prepared a fresh Keycloak realm import volume.\n");
  process.stdout.write(
    "No guest or container port is forwarded to the host.\n",
  );

  const result = await vm.shell({ cwd: "/workspace" });
  process.exitCode = result.exitCode;
} finally {
  await vm.close();
}
