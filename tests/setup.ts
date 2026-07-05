import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// src/lib/db.ts opens the SQLite file (and runs a PRAGMA) at import time, and
// several pure functions live in modules that import it transitively. Point it
// at a throwaway database so unit tests never need — or touch — real data.
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "fuel-test-")), "test.db")}`;
