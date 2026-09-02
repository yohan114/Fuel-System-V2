// Prove a backup file is a usable database, not just bytes that arrived.
//
//     node scripts/verify-backup.cjs <path-to-uncompressed.db>
//
// Exits 0 when the file opens, passes integrity_check and holds a plausible
// fleet. Exits 1 when it does not.
//
// It exists as a file rather than a `node -e` string inside the shell script
// for two reasons: an inline script has to survive shell quoting, which mangled
// it repeatedly; and this way you can run the same check by hand on any backup
// you are unsure about, which is the moment you most want it.
const Database = require("better-sqlite3");

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/verify-backup.cjs <path-to.db>");
  process.exit(2);
}

let db;
try {
  db = new Database(path, { readonly: true });
} catch (err) {
  console.error("    cannot open:", err.message);
  process.exit(1);
}

try {
  // better-sqlite3 opens lazily, so `new Database()` succeeds on any file that
  // exists — a truncated download or a text file only fails here, at the first
  // real read. This is where "not a database" is actually detected.
  let chk;
  try {
    chk = db.pragma("integrity_check")[0].integrity_check;
  } catch (err) {
    console.error("    not a database:", err.message);
    process.exit(1);
  }
  if (chk !== "ok") {
    console.error("    integrity_check:", chk);
    process.exit(1);
  }

  // A file can be valid SQLite and still not be this system's database — a
  // stray dev.db, or a half-restored file. Report that as a verdict rather than
  // letting a missing table surface as a stack trace, which reads like the
  // checker crashed instead of the backup being wrong.
  const n = (sql) => {
    try {
      return db.prepare(sql).get().n;
    } catch (err) {
      if (/no such table/i.test(err.message)) {
        console.error("    not a fuel-system database:", err.message);
        process.exit(1);
      }
      throw err;
    }
  };
  const users = n("select count(*) n from User");

  console.log("    integrity_check : ok");
  console.log("    users           :", users);
  console.log("    assets          :", n("select count(*) n from Asset"));
  console.log("    fuel issues     :", n("select count(*) n from FuelIssue where voided=0"));
  console.log("    bills           :", n("select count(*) n from Bill"));

  const latest = db.prepare("select max(issueDate) m from FuelIssue where voided=0").get().m;
  if (latest) {
    console.log(
      "    latest issue    :",
      new Date(latest).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }),
    );
  }

  // The failure this is really for. `next build` leaves an empty data/app.db
  // behind, and a backup job pointed at the wrong path snapshots it, gzips a
  // few KB of nothing and reports success — which is exactly what the archives
  // from 22 August 2026 turned out to contain.
  if (users === 0) {
    console.error("    zero users — this is an empty database, not the live one");
    process.exit(1);
  }
} finally {
  db.close();
}
