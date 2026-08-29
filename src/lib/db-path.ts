import path from "path";

// Where the live database actually is, resolved the same way src/lib/db.ts
// resolves it.
//
// Three separate places used to hardcode process.cwd()/data/app.db: the
// snapshot helper behind the nightly cron backup, the standalone backup script,
// and the admin screen's "Run backup" button. That is correct only while the
// database sits inside the working tree. In production it does not — it lives
// at /var/lib/fuel-system/app.db, outside the repo, precisely so that a git
// checkout cannot overwrite it.
//
// The consequence of the hardcode was worse than a plain failure. `next build`
// leaves an empty data/app.db behind, so the backup would find a file, snapshot
// it successfully, gzip 4 KB of nothing, upload it to Drive and write a cheerful
// success row to the audit log — while the real database went unbacked-up. A
// backup system that reports success on the wrong file is worse than none,
// because it stops anybody checking.
//
// Deliberately free of any Prisma or database import so a script can call it
// without opening a connection.

/**
 * The absolute path of the live SQLite file.
 *
 * FUEL_DATABASE_URL first, matching src/lib/db.ts: this app keeps its own
 * database when co-hosted with the other E&C systems, where a bare
 * DATABASE_URL would be ambiguous.
 */
export function liveDbPath(): string {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  let f = url.replace(/^file:/, "");
  // file:///abs/path and file://abs/path both mean the same absolute path.
  while (f.startsWith("//")) f = f.slice(1);
  return path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
}

/**
 * Where a snapshot's temporary file belongs: beside the database, never under
 * the working directory. SQLite's online-backup API writes the copy page by
 * page, and on the server /var/lib and the repo can be different filesystems —
 * a cross-device rename or a full disk under the app directory would fail a
 * backup that had otherwise worked.
 */
export function liveDbDir(): string {
  return path.dirname(liveDbPath());
}

/**
 * Where finished backups are written. Overridable because on the server they
 * belong outside the repository — the tree is force-checked-out on deploy, and
 * anything inside it is disposable by definition.
 */
export function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
}
