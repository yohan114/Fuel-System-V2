/**
 * Produce the single database file that ships to the server.
 *
 *   npx tsx scripts/make-ship-db.ts
 *
 * SQLite runs in WAL mode, so the newest writes live in data/app.db-wal, not in
 * data/app.db. Copying app.db on its own loses them and gives no sign of it:
 * the copy opens cleanly and integrity_check says ok. Checkpointing first folds
 * the WAL back in; VACUUM INTO then emits one self-contained file with no
 * sidecars, so nothing can be lost or mismatched in transit.
 *
 * Prints the row counts and a SHA-256 to compare on the far side.
 */
import Database from "better-sqlite3";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { liveDbPath } from "../src/lib/db-path";

const SRC = liveDbPath();
const OUT = process.env.OUT || path.join(path.dirname(SRC), "app-ship.db");

function main() {
  if (!fs.existsSync(SRC)) throw new Error(`No database at ${SRC}`);
  console.log(`source : ${SRC}`);
  console.log(`target : ${OUT}\n`);

  // A stale target would be silently kept by VACUUM INTO, which refuses to
  // overwrite — better to say so than to ship yesterday's file.
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { force: true });
    console.log("removed a previous app-ship.db");
  }
  for (const sidecar of ["-wal", "-shm"]) fs.rmSync(OUT + sidecar, { force: true });

  const db = new Database(SRC);
  try {
    const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
    console.log("integrity_check :", integrity[0]?.integrity_check);
    if (integrity[0]?.integrity_check !== "ok") throw new Error("integrity check failed — do not ship this file");

    // busy must be 0. A non-zero busy means a writer is still attached and the
    // checkpoint only partially ran, so the WAL still holds committed data.
    const cp = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number; log: number; checkpointed: number }[];
    console.log("wal_checkpoint  :", JSON.stringify(cp[0]));
    if (cp[0] && cp[0].busy !== 0) {
      throw new Error("checkpoint incomplete — another process is writing. Stop it and rerun.");
    }

    db.exec(`VACUUM INTO '${OUT.replace(/\\/g, "/")}'`);

    const counts = {
      users: (db.prepare("SELECT COUNT(*) c FROM User").get() as { c: number }).c,
      assets: (db.prepare("SELECT COUNT(*) c FROM Asset").get() as { c: number }).c,
      fuelIssues: (db.prepare("SELECT COUNT(*) c FROM FuelIssue").get() as { c: number }).c,
      bills: (db.prepare("SELECT COUNT(*) c FROM Bill").get() as { c: number }).c,
    };
    console.log("\ncounts in the SOURCE :", JSON.stringify(counts));

    // Read the counts back out of the shipped file too. If VACUUM INTO wrote a
    // partial or wrong file, comparing it against itself would not show it.
    const out = new Database(OUT, { readonly: true });
    const outCounts = {
      users: (out.prepare("SELECT COUNT(*) c FROM User").get() as { c: number }).c,
      assets: (out.prepare("SELECT COUNT(*) c FROM Asset").get() as { c: number }).c,
      fuelIssues: (out.prepare("SELECT COUNT(*) c FROM FuelIssue").get() as { c: number }).c,
      bills: (out.prepare("SELECT COUNT(*) c FROM Bill").get() as { c: number }).c,
    };
    out.close();
    console.log("counts in the SHIP   :", JSON.stringify(outCounts));
    if (JSON.stringify(counts) !== JSON.stringify(outCounts)) {
      throw new Error("the shipped file does not match the source — do not ship it");
    }

    for (const sidecar of ["-wal", "-shm"]) {
      if (fs.existsSync(OUT + sidecar)) throw new Error(`VACUUM INTO left ${OUT + sidecar} — the file is not self-contained`);
    }

    const bytes = fs.readFileSync(OUT);
    const sha = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(path.join(path.dirname(OUT), "app-ship.db.sha256"), `${sha}  app-ship.db\n`);

    console.log(`\nsize   : ${(bytes.length / 1048576).toFixed(1)} MB`);
    console.log(`sha256 : ${sha}`);
    console.log("\nOK — no -wal or -shm beside it. Compare the counts and this hash on the server.");
  } finally {
    db.close();
  }
}

main();
