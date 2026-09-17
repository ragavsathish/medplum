import {
  createHttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  VmCheckpoint,
} from "@earendil-works/gondolin";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(toolDirectory, "../..");
export const workspace = path.resolve(
  process.env.MEDPLUM_HEALTH_WORKSPACE ?? repositoryRoot,
);
export const imageRef =
  process.env.MEDPLUM_HEALTH_GONDOLIN_IMAGE ??
  "medplum-health-tracking:alpine-3.23";
export const defaultCheckpointPath = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "gondolin",
  "medplum-health-images.aarch64.qcow2",
);

const composePath = path.join(workspace, "docker-compose.full-stack.yml");
const keycloakRealmPath = path.join(
  workspace,
  "examples/medplum-health-tracking/docker/keycloak/family-wellness-realm.json",
);
const composeOverrideGuestPath =
  "/opt/medplum-gondolin/docker-compose.gondolin.yml";
const keycloakImportVolume = "medplum-health-keycloak-import";
// /var/cache is tmpfs in Gondolin; /var/lib persists in disk checkpoints.
const nodeModulesCacheRoot = "/var/lib/medplum-node-modules";
const nodeModulesHashPath = `${nodeModulesCacheRoot}/package-lock.sha256`;

export function validateWorkspace() {
  if (!fs.existsSync(composePath)) {
    throw new Error(`No Medplum Compose checkout found at ${workspace}`);
  }
}

export function resolveCheckpointForStartup() {
  if (process.env.MEDPLUM_HEALTH_CHECKPOINT === "none") return undefined;

  const checkpointPath = path.resolve(
    process.env.MEDPLUM_HEALTH_CHECKPOINT ??
      process.env.MEDPLUM_HEALTH_CHECKPOINT_PATH ??
      defaultCheckpointPath,
  );
  if (process.env.MEDPLUM_HEALTH_CHECKPOINT && !fs.existsSync(checkpointPath)) {
    throw new Error(`Gondolin checkpoint does not exist: ${checkpointPath}`);
  }
  return fs.existsSync(checkpointPath) ? checkpointPath : undefined;
}

export function resolveCheckpointForBuild() {
  const configured =
    process.env.MEDPLUM_HEALTH_CHECKPOINT_PATH ??
    (process.env.MEDPLUM_HEALTH_CHECKPOINT !== "none"
      ? process.env.MEDPLUM_HEALTH_CHECKPOINT
      : undefined);
  return path.resolve(configured ?? defaultCheckpointPath);
}

export function createVmOptions() {
  const { httpHooks, env } = createHttpHooks({
    allowedHosts: [
      "*.docker.com",
      "*.docker.io",
      "*.quay.io",
      "dl-cdn.alpinelinux.org",
      "quay.io",
      "registry.npmjs.org",
    ],
  });
  const hasKeycloakRealm = fs.existsSync(keycloakRealmPath);

  return {
    sessionLabel: `medplum-health ${path.basename(workspace)}`,
    sandbox: {
      imagePath: imageRef,
      netEnabled: true,
    },
    memory: process.env.MEDPLUM_HEALTH_VM_MEMORY ?? "8G",
    cpus: Number(process.env.MEDPLUM_HEALTH_VM_CPUS ?? "4"),
    rootfs: {
      mode: "cow",
      size: process.env.MEDPLUM_HEALTH_VM_DISK ?? "24G",
    },
    httpHooks,
    env: {
      ...env,
      ...(hasKeycloakRealm
        ? {
            COMPOSE_FILE: `/workspace/docker-compose.full-stack.yml:${composeOverrideGuestPath}`,
          }
        : {}),
    },
    allowWebSockets: false,
    vfs: {
      mounts: {
        "/workspace": new RealFSProvider(workspace),
        "/opt/medplum-gondolin": new ReadonlyProvider(
          new RealFSProvider(toolDirectory),
        ),
      },
    },
  };
}

export async function createVm({ checkpointPath } = {}) {
  const vmOptions = createVmOptions();
  return checkpointPath
    ? await VmCheckpoint.load(checkpointPath).resume(vmOptions)
    : await VM.create(vmOptions);
}

export async function waitForDocker(vm) {
  for (let attempt = 1; attempt <= 60; attempt++) {
    const result = await vm.exec([
      "/bin/bash",
      "-lc",
      "docker info >/dev/null 2>&1",
    ]);
    if (result.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const logs = await vm.exec([
    "/bin/bash",
    "-lc",
    "tail -n 200 /var/log/dockerd.log 2>/dev/null || true",
  ]);
  throw new Error(
    `Docker did not become ready inside Gondolin:\n${logs.stdout}${logs.stderr}`,
  );
}

export async function prepareKeycloakRealm(vm) {
  if (!fs.existsSync(keycloakRealmPath)) return false;

  const setup = await vm.exec([
    "/bin/bash",
    "-lc",
    `docker volume rm -f ${keycloakImportVolume} >/dev/null 2>&1 || true
docker volume create ${keycloakImportVolume} >/dev/null`,
  ]);
  if (setup.exitCode !== 0) {
    throw new Error(
      `Could not create the Keycloak realm volume:\n${setup.stdout}${setup.stderr}`,
    );
  }

  const copy = vm.exec(
    [
      "/bin/bash",
      "-lc",
      `docker run --rm -i -v ${keycloakImportVolume}:/import alpine:3.23 sh -c 'umask 022; cat > /import/family-wellness-realm.json'`,
    ],
    { stdin: true },
  );
  copy.write(fs.readFileSync(keycloakRealmPath));
  copy.end();
  const result = await copy;
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not stage the Keycloak realm:\n${result.stdout}${result.stderr}`,
    );
  }
  return true;
}

function getNodeModulesCache() {
  const packageLockPath = path.join(workspace, "package-lock.json");
  if (!fs.existsSync(packageLockPath)) return undefined;

  const packageLockContents = fs.readFileSync(packageLockPath);
  const packageLock = JSON.parse(packageLockContents);
  const workspacePaths = Object.keys(packageLock.packages ?? {})
    .filter(
      (entry) =>
        entry &&
        !entry.includes("node_modules") &&
        !entry.startsWith("/") &&
        !entry.split("/").includes("..") &&
        fs.existsSync(path.join(workspace, entry, "package.json")),
    )
    .sort();

  return {
    hash: crypto.createHash("sha256").update(packageLockContents).digest("hex"),
    mounts: [
      {
        cachePath: `${nodeModulesCacheRoot}/root`,
        workspacePath: "/workspace/node_modules",
      },
      ...workspacePaths.map((entry) => ({
        cachePath: `${nodeModulesCacheRoot}/workspaces/${entry}/node_modules`,
        workspacePath: `/workspace/${entry}/node_modules`,
      })),
    ],
  };
}

async function mountNodeModules(vm, mounts) {
  for (const mount of mounts) {
    const result = await vm.exec([
      "/bin/mkdir",
      "-p",
      mount.cachePath,
      mount.workspacePath,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not create node_modules cache path: ${mount.workspacePath}`,
      );
    }
    const mounted = await vm.exec([
      "/bin/mount",
      "--bind",
      mount.cachePath,
      mount.workspacePath,
    ]);
    if (mounted.exitCode !== 0) {
      throw new Error(
        `Could not mount node_modules cache: ${mount.workspacePath}`,
      );
    }
  }
}

export async function prepareNodeModulesCache(vm) {
  const cache = getNodeModulesCache();
  if (!cache) return { status: "unavailable" };

  const cachedHash = await vm.exec([
    "/bin/sh",
    "-c",
    `cat ${nodeModulesHashPath} 2>/dev/null || true`,
  ]);
  if (cachedHash.stdout.trim() !== cache.hash) {
    return {
      status: "stale",
      expectedHash: cache.hash,
      cachedHash: cachedHash.stdout.trim(),
    };
  }

  await mountNodeModules(vm, cache.mounts);
  return { status: "mounted", count: cache.mounts.length, hash: cache.hash };
}

export async function buildNodeModulesCache(vm) {
  const cache = getNodeModulesCache();
  if (!cache) throw new Error(`No package-lock.json found at ${workspace}`);

  const reset = await vm.exec(["/bin/rm", "-rf", nodeModulesCacheRoot]);
  if (reset.exitCode !== 0)
    throw new Error("Could not reset the node_modules cache");
  await mountNodeModules(vm, cache.mounts);

  await runChecked(
    vm,
    "cd /workspace && npm ci",
    "npm dependency installation",
  );
  const marker = await vm.exec([
    "/bin/sh",
    "-c",
    `printf %s ${cache.hash} > ${nodeModulesHashPath}`,
  ]);
  if (marker.exitCode !== 0)
    throw new Error("Could not write the node_modules cache marker");

  return { count: cache.mounts.length, hash: cache.hash };
}

export async function runChecked(vm, command, description) {
  const result = await vm.exec(["/bin/bash", "-lc", command]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`${description} failed with exit code ${result.exitCode}`);
  }
  return result;
}
