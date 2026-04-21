import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { get, put } from "@vercel/blob";

const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const SNAPSHOT_SETUP_TIMEOUT_MS = 15 * 60 * 1000;
const SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000;
const SANDBOX_OPTS = { runtime: "node22", resources: { vcpus: 4 } } as const;

const pointerKey = (deploymentId: string) => `snapshot-cache/${deploymentId}.json`;

export interface RenderResult {
  mp4: Buffer;
  durationMs: number;
}

/**
 * Install system dependencies and the hyperframes CLI inside a sandbox.
 * Shared between snapshot creation (build time) and fresh-sandbox fallback (local dev).
 */
export async function prepareSandbox(sandbox: Sandbox): Promise<void> {
  const [dnf, install] = await Promise.all([
    sandbox.runCommand({
      cmd: "dnf",
      args: [
        "install", "-y", "--setopt=install_weak_deps=False",
        "nss", "nspr", "atk", "at-spi2-atk", "cups-libs",
        "libdrm", "libxkbcommon", "libXcomposite", "libXdamage",
        "libXext", "libXfixes", "libXrandr", "mesa-libgbm",
        "alsa-lib", "pango",
      ],
      sudo: true,
    }),
    sandbox.runCommand({
      cmd: "npm",
      args: [
        "install", "--no-save", "--no-audit", "--no-fund",
        "hyperframes@latest", "ffmpeg-static",
      ],
    }),
  ]);
  if (dnf.exitCode !== 0) {
    throw new Error(`dnf install failed (exit ${dnf.exitCode}):\n${await dnf.stderr()}`);
  }
  if (install.exitCode !== 0) {
    throw new Error(`npm install failed (exit ${install.exitCode}):\n${await install.stderr()}`);
  }

  const link = await sandbox.runCommand({
    cmd: "ln",
    args: ["-sf", "/vercel/sandbox/node_modules/ffmpeg-static/ffmpeg", "/usr/local/bin/ffmpeg"],
    sudo: true,
  });
  if (link.exitCode !== 0) {
    throw new Error(`ffmpeg symlink failed (exit ${link.exitCode}):\n${await link.stderr()}`);
  }
}

export async function createFreshSetupSandbox(): Promise<Sandbox> {
  return Sandbox.create({ ...SANDBOX_OPTS, timeout: SNAPSHOT_SETUP_TIMEOUT_MS });
}

export async function writeSnapshotPointer(params: {
  deploymentId: string;
  snapshotId: string;
  token: string;
}): Promise<void> {
  await put(
    pointerKey(params.deploymentId),
    JSON.stringify({ snapshotId: params.snapshotId }),
    {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: params.token,
    },
  );
}

async function readSnapshotId(deploymentId: string, token: string): Promise<string> {
  const result = await get(pointerKey(deploymentId), { access: "public", token });
  if (!result || result.statusCode !== 200) {
    throw new Error(`snapshot pointer missing for deployment ${deploymentId}`);
  }
  const { snapshotId } = (await new Response(result.stream).json()) as { snapshotId: string };
  return snapshotId;
}

async function restoreOrCreate(): Promise<Sandbox> {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (deploymentId && token) {
    try {
      const snapshotId = await readSnapshotId(deploymentId, token);
      console.log(`[sandbox] restoring snapshot ${snapshotId}`);
      return await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        timeout: RENDER_TIMEOUT_MS,
        resources: SANDBOX_OPTS.resources,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.env.VERCEL_ENV === "production") {
        throw new Error(`snapshot restore failed in production: ${msg}`);
      }
      console.warn(`[sandbox] snapshot restore failed in dev, falling back: ${msg}`);
    }
  }

  const sandbox = await Sandbox.create({ ...SANDBOX_OPTS, timeout: RENDER_TIMEOUT_MS });
  await prepareSandbox(sandbox);
  return sandbox;
}

export async function renderInSandbox(compositionFiles: ReadonlyArray<{ rel: string; content: Buffer }>): Promise<RenderResult> {
  const t0 = Date.now();
  const sandbox = await restoreOrCreate();

  try {
    console.log(`[sandbox] id=${sandbox.sandboxId}`);

    console.log(`[sandbox] writing ${compositionFiles.length} composition files`);
    await sandbox.writeFiles(
      compositionFiles.map(({ rel, content }) => ({
        path: `composition/${rel}`,
        content,
      })),
    );

    console.log("[sandbox] rendering");
    const render = await sandbox.runCommand({
      cmd: "npx",
      args: [
        "--no-install", "hyperframes", "render", "composition",
        "-o", "out.mp4",
        "--workers", "auto",
      ],
    });
    if (render.exitCode !== 0) {
      throw new Error(`render failed (exit ${render.exitCode}):\n${await render.stderr()}`);
    }

    const mp4 = await sandbox.readFileToBuffer({ path: "out.mp4" });
    if (!mp4) throw new Error("render produced no out.mp4");
    const durationMs = Date.now() - t0;
    console.log(`[sandbox] done in ${Math.round(durationMs / 1000)}s`);
    return { mp4, durationMs };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

export async function collectFiles(
  root: string,
): Promise<Array<{ rel: string; content: Buffer }>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e) => {
        const abs = join(e.parentPath, e.name);
        return { rel: relative(root, abs), content: await readFile(abs) };
      }),
  );
}

export { SNAPSHOT_SETUP_TIMEOUT_MS, SNAPSHOT_TTL_MS };
