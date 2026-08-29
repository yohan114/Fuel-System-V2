/**
 * Rotate every staff password.
 *
 *   npx tsx scripts/rotate-passwords.ts            # dry run — shows what would change
 *   npx tsx scripts/rotate-passwords.ts --apply    # writes, and prints the new credentials ONCE
 *   npx tsx scripts/rotate-passwords.ts --apply --only admin,malinga
 *
 * Why this exists: data/app.db was committed to a public repository across 143
 * commits, so all twelve bcrypt hashes are public and can be attacked offline
 * at leisure. Worse, SEED_ADMIN_PASSWORD is in the history in plaintext and the
 * `admin` account still used it — a working administrator login for anyone who
 * read the repo.
 *
 * Rotating the hash does not un-publish the old one. It makes it worthless.
 *
 * The generated passwords are meant to be typed by site pump operators on a
 * phone, so the alphabet excludes the characters people confuse — no O/0, no
 * I/l/1 — and they are printed in groups of four. Twelve characters from a
 * 56-character alphabet is about 70 bits, which is far beyond what an offline
 * attack on bcrypt cost 10 will reach.
 */
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import { liveDbPath } from "../src/lib/db-path";

const APPLY = process.argv.includes("--apply");
const onlyArg = process.argv.find((a) => a.startsWith("--only="))
  ?? (process.argv.includes("--only") ? `--only=${process.argv[process.argv.indexOf("--only") + 1]}` : undefined);
const ONLY = onlyArg ? onlyArg.replace("--only=", "").split(",").map((s) => s.trim()).filter(Boolean) : null;

// The app hashes at cost 10 (src/app/actions/admin.ts). Matching it keeps
// sign-in latency the same and keeps every hash in the table consistent.
const COST = 10;

// No O/0, no I/l/1 — the characters that cause "it says wrong password" calls.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function newPassword(): string {
  // randomInt is rejection-sampled and unbiased; % would skew toward the first
  // few letters of the alphabet.
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}-${group()}`;
}

async function main() {
  console.log(`database : ${liveDbPath()}`);
  console.log(`mode     : ${APPLY ? "APPLY — this will write" : "dry run — nothing will be written"}\n`);

  const users = await prisma.user.findMany({
    select: { id: true, username: true, name: true, role: true, active: true, passwordHash: true },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });

  const targets = ONLY ? users.filter((u) => ONLY.includes(u.username)) : users;
  if (ONLY) {
    const missing = ONLY.filter((n) => !users.some((u) => u.username === n));
    if (missing.length) throw new Error(`no such user: ${missing.join(", ")}`);
  }
  console.log(`rotating ${targets.length} of ${users.length} accounts\n`);

  if (!APPLY) {
    for (const u of targets) {
      console.log(`  would rotate  ${u.username.padEnd(18)} ${u.role.padEnd(11)} ${u.name}`);
    }
    console.log("\nRe-run with --apply to write. The new passwords are shown once, then only in the file.");
    return;
  }

  // A rotation is irreversible from inside the app — if it goes wrong halfway
  // nobody can log in to fix it. Take a copy first.
  const src = liveDbPath();
  // yyyymmddhhmmss — 14 characters. slice(0, 15) kept the "." of the
  // milliseconds and produced filenames like "new-passwords-2026...654..txt".
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backup = path.join(path.dirname(src), `app.db.pre-rotate-${stamp}`);
  fs.copyFileSync(src, backup);
  console.log(`backup   : ${backup}\n`);

  const issued: { username: string; name: string; role: string; password: string }[] = [];

  for (const u of targets) {
    const password = newPassword();
    const hash = bcrypt.hashSync(password, COST);

    // Verify BEFORE writing. A hash that does not validate its own password
    // locks the account out permanently, and the only sign would be a support
    // call from somebody who cannot get in.
    if (!bcrypt.compareSync(password, hash)) throw new Error(`generated hash does not validate for ${u.username}`);
    if (bcrypt.compareSync(password, u.passwordHash)) throw new Error(`generated the SAME password as the old one for ${u.username}`);

    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: "UPDATE",
          entity: "User",
          entityId: u.id,
          summary: `Password rotated for ${u.username} — the previous hash was published in the public repository`,
          metaJson: JSON.stringify({
            username: u.username, reason: "public-repo-exposure", cost: COST,
            oldHashPrefix: u.passwordHash.slice(0, 7), rotatedAt: new Date().toISOString(),
          }),
        },
      }),
    ]);

    // Read it back out of the database, not from the variable we just built.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true } });
    if (!bcrypt.compareSync(password, after.passwordHash)) throw new Error(`stored hash does not validate for ${u.username}`);
    if (after.passwordHash === u.passwordHash) throw new Error(`hash unchanged in the database for ${u.username}`);

    issued.push({ username: u.username, name: u.name, role: u.role, password });
    console.log(`  rotated  ${u.username.padEnd(18)} ${u.role.padEnd(11)} verified`);
  }

  // Written next to the database, outside the repo tree in production, and
  // 0600. Hand these out and delete the file.
  const outPath = path.join(path.dirname(src), `new-passwords-${stamp}.txt`);
  const lines = [
    "E&C Fuel System — new staff passwords",
    `Issued ${new Date().toISOString()}`,
    "",
    "The previous passwords were exposed: the database was committed to a public",
    "GitHub repository, so every old hash is public and crackable offline, and the",
    "admin account's password was in the history in plaintext.",
    "",
    "Give each person their own line, in person or by a channel they already trust.",
    "Do not email this file. Delete it once the passwords are handed out.",
    "",
    ...issued.map((i) => `${i.username.padEnd(18)} ${i.role.padEnd(11)} ${i.password}    (${i.name})`),
    "",
  ];
  fs.writeFileSync(outPath, lines.join("\n"), { mode: 0o600 });

  console.log(`\ncredentials written to: ${outPath}  (mode 0600)\n`);
  console.log(lines.slice(9).join("\n"));
  console.log("Existing browser sessions are NOT signed out — sessions are JWTs and survive");
  console.log("a password change. To force everyone out, change FUEL_AUTH_SECRET and restart.");
}

main()
  .catch((e) => { console.error("\nFAILED:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
