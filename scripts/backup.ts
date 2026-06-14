import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

async function runBackup() {
  console.log("Starting database backup...");

  const dbPath = path.join(process.cwd(), "data", "app.db");
  const backupDir = path.join(process.cwd(), "backups");

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Source database does not exist at ${dbPath}`);
    process.exit(1);
  }

  // Ensure backup folder exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Generate backup filename with timestamp
  const now = new Date();
  const formatDigit = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}${formatDigit(now.getMonth() + 1)}${formatDigit(now.getDate())}-${formatDigit(now.getHours())}${formatDigit(now.getMinutes())}${formatDigit(now.getSeconds())}`;
  const backupFilename = `app-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFilename);

  let sourceDb;
  try {
    // Open source database in readonly mode
    sourceDb = new Database(dbPath, { readonly: true });
    
    // Execute atomic backup using native VACUUM INTO
    // Replacing backslashes with forward slashes for SQLite compatibility on Windows
    const escapedBackupPath = backupPath.replace(/\\/g, "/");
    sourceDb.exec(`VACUUM INTO '${escapedBackupPath}'`);
    console.log(`Backup completed successfully: ${backupFilename}`);
  } catch (err) {
    console.error("Backup failed during VACUUM:", err);
    process.exit(1);
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
  }

  // Apply retention rotation policy
  try {
    // Re-open source database to fetch retention days setting
    sourceDb = new Database(dbPath, { readonly: true });
    const row = sourceDb.prepare("SELECT value FROM Setting WHERE key = 'backup.retentionDays'").get() as { value: string } | undefined;
    const retentionDays = row ? parseInt(row.value, 10) : 7;
    sourceDb.close();

    console.log(`Applying retention policy (keeping last ${retentionDays} days of backups)...`);
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("app-") && f.endsWith(".db"))
      .map(f => {
        const fullPath = path.join(backupDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Keep backups created within the retention window, or always keep at least the last few
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    
    // Delete files that are older than cutoff AND are not in the top 3 newest (to guarantee we don't delete everything)
    let deletedCount = 0;
    files.forEach((file, index) => {
      if (file.mtime < cutoffTime && index >= 3) {
        fs.unlinkSync(file.path);
        console.log(`Deleted expired backup: ${file.name}`);
        deletedCount++;
      }
    });
    
    console.log(`Backup rotation complete. Deleted ${deletedCount} expired backup file(s).`);
  } catch (err) {
    console.error("Failed to apply backup rotation policy:", err);
  }
}

runBackup();
