import Database from "better-sqlite3";
import { gzipSync } from "zlib";
import fs from "fs";
import path from "path";
import { liveDbPath, liveDbDir } from "../db-path";

// Consistent, compressed snapshot of the live SQLite database. Uses the
// SQLite online-backup API (safe while the app is writing, WAL included)
// into a temp file, then gzips it. Returns the gzip bytes plus a
// date-stamped file name like fuel-backup-20260706-0300.db.gz.

export interface Snapshot {
  fileName: string;
  bytes: Buffer;
  rawBytes: number;
}

export async function snapshotDatabase(dbPath = liveDbPath()): Promise<Snapshot> {
  // Says which path it looked at. The old message named data/app.db whatever
  // had actually been checked, which sent people looking in the wrong place.
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found at ${dbPath}`);

  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  // Beside the database being copied, not under the working directory — on the
  // server those are different filesystems.
  const tmp = path.join(liveDbDir(), `.backup-tmp-${process.pid}.db`);

  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(tmp);
  } finally {
    db.close();
  }

  try {
    const raw = fs.readFileSync(tmp);
    const bytes = gzipSync(raw, { level: 6 });
    return { fileName: `fuel-backup-${stamp}.db.gz`, bytes, rawBytes: raw.length };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
