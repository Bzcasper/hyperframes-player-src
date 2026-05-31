import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
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

type RunCommandOpts = Parameters<Sandbox["runCommand"]>[0];

export async function runSandboxCommand(
  sandbox: Sandbox,
  label: string,
  opts: RunCommandOpts,
): Promise<void> {
  const result = await sandbox.runCommand(opts);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}):\n${await result.stderr()}`);
  }
}

export async function prepareSandbox(sandbox: Sandbox): Promise<void> {
  await Promise.all([
    runSandboxCommand(sandbox, "dnf install", {
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
    runSandboxCommand(sandbox, "npm install", {
      cmd: "npm",
      args: [
        "install", "--no-save", "--no-audit", "--no-fund",
        "hyperframes@latest", "ffmpeg-static", "ffprobe-static",
      ],
    }),
  ]);

  await Promise.all([
    runSandboxCommand(sandbox, "ffmpeg symlink", {
      cmd: "ln",
      args: ["-sf", "/vercel/sandbox/node_modules/ffmpeg-static/ffmpeg", "/usr/local/bin/ffmpeg"],
      sudo: true,
    }),
    runSandboxCommand(sandbox, "ffprobe symlink", {
      cmd: "ln",
      args: ["-sf", "/vercel/sandbox/node_modules/ffprobe-static/bin/linux/x64/ffprobe", "/usr/local/bin/ffprobe"],
      sudo: true,
    }),
  ]);
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
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: params.token,
    },
  );
}

async function readSnapshotId(deploymentId: string, token: string): Promise<string> {
  const result = await get(pointerKey(deploymentId), { access: "private", token });
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
    // Load and inject the HyperFrames runtime so the sandbox file
    // server can serve it at /api/runtime.js.  Compositions generated
    // from VideoSpec reference this path and the hyperframes renderer
    // polls for window.__hf which the runtime initialises.
    const runtimeBuf = await loadHyperframesRuntime();
    const allFiles = [...compositionFiles];
    if (runtimeBuf) {
      allFiles.push({ rel: "api/runtime.js", content: runtimeBuf });
    } else if (process.env.VERCEL_ENV === "production") {
      throw new Error("hyperframes runtime not found — cannot render without /api/runtime.js");
    }

    await sandbox.writeFiles(
      allFiles.map(({ rel, content }) => ({
        path: `composition/${rel}`,
        content,
      })),
    );

    await runSandboxCommand(sandbox, "render", {
      cmd: "npx",
      args: [
        "--no-install", "hyperframes", "render", "composition",
        "-o", "out.mp4",
        "--workers", "auto",
      ],
    });

    const mp4 = await sandbox.readFileToBuffer({ path: "out.mp4" });
    if (!mp4) throw new Error("render produced no out.mp4");
    return { mp4, durationMs: Date.now() - t0 };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

const HYPERFRAMES_RUNTIME_PATHS = [
  join(process.cwd(), "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
  join(dirname(process.cwd()), "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
];

async function loadHyperframesRuntime(): Promise<Buffer | null> {
  for (const p of HYPERFRAMES_RUNTIME_PATHS) {
    try {
      return await readFile(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
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

export { SNAPSHOT_TTL_MS };
