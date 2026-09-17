import fs from "node:fs";
import path from "node:path";
import {
  buildNodeModulesCache,
  createVm,
  resolveCheckpointForBuild,
  runChecked,
  validateWorkspace,
  waitForDocker,
  workspace,
} from "./vm-support.mjs";

validateWorkspace();

const checkpointPath = resolveCheckpointForBuild();
if (
  fs.existsSync(checkpointPath) &&
  process.env.FORCE_MEDPLUM_HEALTH_CHECKPOINT !== "1"
) {
  process.stdout.write(`Reusing image-only checkpoint ${checkpointPath}\n`);
  process.stdout.write(
    "Set FORCE_MEDPLUM_HEALTH_CHECKPOINT=1 to refresh its Docker images.\n",
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
const temporaryCheckpointPath = `${checkpointPath}.tmp-${process.pid}.qcow2`;
if (fs.existsSync(temporaryCheckpointPath)) fs.rmSync(temporaryCheckpointPath);

const vm = await createVm();
let checkpointed = false;
try {
  await waitForDocker(vm);
  await runChecked(
    vm,
    "docker compose -f /workspace/docker-compose.full-stack.yml pull && docker pull alpine:3.23",
    "Docker image pull",
  );
  const nodeModulesCache = await buildNodeModulesCache(vm);
  process.stdout.write(
    `Cached Linux node_modules for ${nodeModulesCache.count} workspace locations ` +
      `(lock ${nodeModulesCache.hash.slice(0, 12)})\n`,
  );
  await runChecked(
    vm,
    `docker compose -f /workspace/docker-compose.full-stack.yml down --volumes --remove-orphans >/dev/null 2>&1 || true
docker container prune -f >/dev/null
docker volume prune -af >/dev/null
docker network prune -f >/dev/null
test -z "$(docker container ls -aq)"
test -z "$(docker volume ls -q)"
docker image ls --format '{{.Repository}}:{{.Tag}}' | sort`,
    "Image-only checkpoint cleanup",
  );
  process.stdout.write(`Creating image-only checkpoint for ${workspace}\n`);
  await vm.checkpoint(temporaryCheckpointPath);
  checkpointed = true;
  fs.renameSync(temporaryCheckpointPath, checkpointPath);
  process.stdout.write(`Checkpoint ready: ${checkpointPath}\n`);
} finally {
  if (!checkpointed) await vm.close();
  if (fs.existsSync(temporaryCheckpointPath))
    fs.rmSync(temporaryCheckpointPath);
}
