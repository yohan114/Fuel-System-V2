import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { snapshotDatabase } from "@/lib/backup/snapshot";
import { driveConfigured, uploadToDrive, pruneOldBackups, backupFolderId } from "@/lib/backup/drive";
import fs from "fs";
import path from "path";
import { errorMessage } from "@/lib/errors";

// Daily database backup, triggered by an external scheduler (e.g. 03:00:
// `0 3 * * *  curl -s "https://<host>/api/cron/backup?secret=$CRON_SECRET"`).
// Takes a consistent gzipped snapshot, keeps a copy in backups/ locally, and
// uploads it to the Google Drive backup folder when the service account is
// configured. ?keepDays= overrides Drive retention (default 30).
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided =
    request.headers.get("x-cron-secret") || request.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snap = await snapshotDatabase();

    // Local copy first — the backup must survive even if Drive is down.
    const backupDir = path.join(process.cwd(), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, snap.fileName), snap.bytes);

    let driveFileId: string | null = null;
    let pruned = 0;
    let driveError: string | null = null;
    if (driveConfigured()) {
      try {
        driveFileId = await uploadToDrive(snap.fileName, snap.bytes);
        const keepDays = parseInt(request.nextUrl.searchParams.get("keepDays") || "30", 10);
        pruned = await pruneOldBackups(isNaN(keepDays) ? 30 : keepDays);
      } catch (err: unknown) {
        // Keep the local backup a success even when the upload fails; surface
        // the Drive problem in the response and the audit log.
        driveError = errorMessage(err) || "Drive upload failed";
        console.error("Drive backup error:", err);
      }
    }

    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Backup",
        summary: `Backup ${snap.fileName} (${(snap.bytes.length / 1024 / 1024).toFixed(1)} MB gz of ${(snap.rawBytes / 1024 / 1024).toFixed(1)} MB)` +
          (driveFileId ? ` uploaded to Drive folder ${backupFolderId()}${pruned ? `, pruned ${pruned} old` : ""}` : driveError ? ` — Drive upload FAILED: ${driveError}` : " (local only — Drive not configured)"),
      },
    });

    return NextResponse.json({
      ok: true,
      file: snap.fileName,
      gzBytes: snap.bytes.length,
      rawBytes: snap.rawBytes,
      drive: driveFileId ? { fileId: driveFileId, pruned } : { configured: driveConfigured(), error: driveError },
    });
  } catch (err: unknown) {
    console.error("Cron backup error:", err);
    return NextResponse.json({ error: errorMessage(err) || "Backup failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
