import {
  createFreshSetupSandbox,
  prepareSandbox,
  SNAPSHOT_TTL_MS,
  writeSnapshotPointer,
} from "../lib/sandbox";

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;

  if (!token || !deploymentId) {
    console.log("[create-snapshot] BLOB_READ_WRITE_TOKEN or VERCEL_DEPLOYMENT_ID missing — skipping (local build)");
    return;
  }

  const t0 = Date.now();
  const sandbox = await createFreshSetupSandbox();

  try {
    await prepareSandbox(sandbox);

    console.log("[create-snapshot] downloading Chrome Headless Shell");
    const browser = await sandbox.runCommand({
      cmd: "npx",
      args: ["--no-install", "hyperframes", "browser", "ensure"],
    });
    if (browser.exitCode !== 0) {
      throw new Error(`browser download failed (exit ${browser.exitCode}):\n${await browser.stderr()}`);
    }

    console.log("[create-snapshot] taking snapshot");
    const snapshot = await sandbox.snapshot({ expiration: SNAPSHOT_TTL_MS });
    const mb = Math.round(snapshot.sizeBytes / 1024 / 1024);
    console.log(`[create-snapshot] snapshotId=${snapshot.snapshotId} size=${mb}MB`);

    await writeSnapshotPointer({
      deploymentId,
      snapshotId: snapshot.snapshotId,
      token,
    });

    const s = Math.round((Date.now() - t0) / 1000);
    console.log(`[create-snapshot] done in ${s}s`);
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[create-snapshot] FAILED", err);
  process.exit(1);
});
