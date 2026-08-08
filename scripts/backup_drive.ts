import { snapshotDatabase } from "../src/lib/backup/snapshot";
import { driveConfigured, uploadToDrive, pruneOldBackups, backupFolderId } from "../src/lib/backup/drive";
import fs from "fs";
import path from "path";

// Manual backup run: `npx tsx scripts/backup_drive.ts` — same code path as the
// /api/cron/backup route (local gzip copy in backups/, plus Google Drive upload
// when GDRIVE_SA_EMAIL / GDRIVE_SA_PRIVATE_KEY are set).

async function main() {
  const snap = await snapshotDatabase();
  const backupDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const localPath = path.join(backupDir, snap.fileName);
  fs.writeFileSync(localPath, snap.bytes);
  console.log(`local: ${localPath} (${(snap.bytes.length / 1024 / 1024).toFixed(2)} MB gz of ${(snap.rawBytes / 1024 / 1024).toFixed(2)} MB)`);

  if (!driveConfigured()) {
    console.log("Drive: not configured (set GDRIVE_SA_EMAIL and GDRIVE_SA_PRIVATE_KEY) — local backup only.");
    return;
  }
  const id = await uploadToDrive(snap.fileName, snap.bytes);
  console.log(`Drive: uploaded ${snap.fileName} → file id ${id} (folder ${backupFolderId()})`);
  const pruned = await pruneOldBackups(30);
  if (pruned > 0) console.log(`Drive: pruned ${pruned} backup(s) older than 30 days`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
