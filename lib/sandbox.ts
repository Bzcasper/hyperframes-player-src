import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Sandbox } from "@vercel/sandbox";

const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export interface RenderResult {
  mp4: Buffer;
  durationMs: number;
}

/**
 * Vercel Sandbox ships Amazon Linux 2023 with Chrome and FFmpeg preinstalled,
 * so `hyperframes` just needs `npm install` and it renders.
 */
export async function renderInSandbox(
  compositionDir: string,
  entry: string,
): Promise<RenderResult> {
  const t0 = Date.now();

  const sandbox = await Sandbox.create({
    runtime: "node22",
    timeout: RENDER_TIMEOUT_MS,
  });

  try {
    console.log(`[sandbox] created ${sandbox.sandboxId}`);

    const files = await collectFiles(compositionDir);
    console.log(`[sandbox] writing ${files.length} composition files`);
    await sandbox.writeFiles(
      files.map(({ rel, content }) => ({
        path: `composition/${rel}`,
        content,
      })),
    );

    console.log("[sandbox] installing hyperframes");
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "--no-save", "--no-audit", "--no-fund", "hyperframes@latest"],
    });
    if (install.exitCode !== 0) {
      throw new Error(`npm install failed (exit ${install.exitCode}):\n${await install.stderr()}`);
    }

    console.log(`[sandbox] rendering ${entry}`);
    const render = await sandbox.runCommand({
      cmd: "npx",
      args: ["--no-install", "hyperframes", "render", `composition/${entry}`, "-o", "out.mp4"],
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

async function collectFiles(
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
