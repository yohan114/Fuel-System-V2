/**
 * One-command full data load for localhost.
 *
 * Runs every import step in the correct order:
 *   1. wipe_all_data        — full reset (keeps 1 ADMIN user + Settings)
 *   2. import_machines      — 518 assets + 29 categories + rate cards (from HTML)
 *   3. import_fuel_cons     — fuel consumption rates (Excel "Fuel Rates" sheet)
 *   4. import_cep_running   — Central Expressway [CEP-03] daily running (Jan–May)
 *   5. import_site_summaries— GB / INGI / KB / BATTI monthly summaries
 *   6. import_badalgama_fuel— Badalgama workshop daily fuel matrices (Mar–May)
 *   7. fix_pv6889           — PV-6889 → Double Cab, billing.minKm = 3000
 *
 * Place all source spreadsheets in ONE folder and point UPLOADS_DIR at it:
 *
 *   # Windows (PowerShell)
 *   $env:UPLOADS_DIR="C:/Users/HP/Downloads/fuel-data"; npm run seed:all
 *
 *   # macOS / Linux
 *   UPLOADS_DIR=/path/to/fuel-data npm run seed:all
 *
 * If UPLOADS_DIR is unset it falls back to the original cloud upload path.
 * Add SKIP_WIPE=1 to keep existing data (re-imports are idempotent anyway).
 *
 * Run: npm run seed:all
 */
import { spawnSync } from "child_process";
import path from "path";

const steps: { name: string; script: string; skip?: boolean }[] = [
  { name: "Wipe all data",        script: "wipe_all_data.ts", skip: process.env.SKIP_WIPE === "1" },
  { name: "Import fuel prices",   script: "import_fuel_prices.ts" },
  { name: "Import machines",      script: "import_machines.ts" },
  { name: "Import fuel cons",     script: "import_fuel_cons.ts" },
  { name: "Import site summaries",script: "import_site_summaries.ts" },
  { name: "Import CEP running",   script: "import_cep_running.ts" },
  { name: "Import Badalgama fuel",script: "import_badalgama_fuel.ts" },
  { name: "Import CEP-03 ABC",    script: "import_cep_abc.ts" },
  { name: "Fix PV-6889 + minKm",  script: "fix_pv6889.ts" },
  { name: "Import portable rates",script: "import_portable_rates.ts" },
  { name: "Import daily sites",   script: "import_daily_sites.ts" },
  { name: "Import summary sites", script: "import_summary_sites.ts" },
  { name: "Swap HEX-27 and HEX-39", script: "fix_hex27_39.ts" },
];

const scriptsDir = path.join(process.cwd(), "scripts");

for (const [i, step] of steps.entries()) {
  const n = `${i + 1}/${steps.length}`;
  if (step.skip) { console.log(`\n[${n}] ⏭  SKIP ${step.name}`); continue; }
  console.log(`\n${"═".repeat(60)}\n[${n}] ▶  ${step.name}  (${step.script})\n${"═".repeat(60)}`);
  const res = spawnSync("npx", ["tsx", `"${path.join(scriptsDir, step.script)}"`], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`\n✗ Step ${n} "${step.name}" failed (exit ${res.status}). Stopping.`);
    process.exit(res.status ?? 1);
  }
}

console.log(`\n✓ All ${steps.length} steps complete. Data loaded.`);
