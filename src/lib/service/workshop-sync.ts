// Live link to the WorkshopOne service system (http://localhost:1929).
//
// WorkshopOne is the workshop's own app and owns the service history. This
// module pulls new and changed service jobs into the fuel system so a service
// booked there shows up here — in the service planner, on the machine page, and
// as the anchor for "work done since the last service".
//
// DIRECTION IS ONE WAY, ALWAYS. WorkshopOne's database is opened READ-ONLY and
// is never written to. If the two disagree, WorkshopOne wins: it is where the
// fitters actually record the work.
//
// WHY A PULL AND NOT A WEBHOOK: both apps run on the same machine, and a pull
// needs no change to WorkshopOne and no shared secret. It also self-heals — if
// this app is down for a day, the next tick catches up everything it missed,
// whereas a missed webhook is lost. SQLite in WAL mode serves a reader while
// WorkshopOne keeps writing, so the sync never blocks the workshop.
//
// IDENTITY: every imported record carries sourceRef "WSO:<service_jobs.id>",
// which is stable in WorkshopOne. Records imported earlier from the 2026-08-10
// archive carry "SRDB:<legacy id>"; the first sync migrates those onto the WSO
// key by matching service_jobs.legacy_service_id, so nothing is imported twice.

import Database from "better-sqlite3";
import { prisma } from "../db";
import { checkServiceMeter, DISTRUSTED_SERVICE_METERS } from "./meter-trust";

export const DEFAULT_WORKSHOP_DB = "D:/Master system 1/data/workshopone.db";

export interface SyncResult {
  ok: boolean;
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  metersAdded: number;
  /** Service meters excluded by hand — see DISTRUSTED_SERVICE_METERS. */
  metersRuledOut: number;
  skippedNoMachine: number;
  skippedNoDate: number;
  migratedFromArchive: number;
  /** Registration numbers taken from WorkshopOne's asset register. */
  platesFilled: number;
  /** Machines where both systems hold a plate and they disagree — never overwritten. */
  plateConflicts: { code: string; ours: string; workshopOne: string }[];
  unresolvedLabels: string[];
  error?: string;
}

// A Sri Lankan plate is letters+digits or the older all-numeric pair. Anything
// else in WorkshopOne's registration column — "FIORI", "14160" — is a model or
// a serial that happens to live in the wrong field, and must not become a plate.
export const PLATE_SHAPE = /^[A-Z]{1,3}[-\s]?\d{3,4}$|^\d{2,3}[-\s]?\d{4}$/i;

interface WorkshopJob {
  id: number;
  legacy_service_id: number | null;
  vehicle_label: string | null;
  asset_id: number | null;
  service_date: string | null;
  job_no: string | null;
  meter_reading: string | null;
  next_service_meter: string | null;
  service_type: string | null;
  site_location: string | null;
  repair_details: string | null;
  parts_subtotal: number | null;
  labour_charge: number | null;
  sundry_amount: number | null;
  grand_total: number | null;
  upkeeping: string | null;
  reg_id: string | null;
}

const norm = (s: unknown) => String(s ?? "").replace(/[-\s/().]/g, "").toUpperCase();
const cents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

// Colombo midnight, matching every other date in this system.
const colombo = (day: string) => new Date(`${day}T00:00:00+05:30`);

/**
 * WorkshopOne stores the meter as free text with the unit attached — "142788 km",
 * "05 Hrs", and also "MNW" when the meter is not working. Only a genuine number
 * is a reading; a zero is not, because a zero would read as a machine freshly
 * serviced at hour nought.
 */
export function parseWorkshopMeter(raw: string | null): { value: number | null; unit: "KM" | "HOURS" | null; text: string | null } {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, unit: null, text: null };
  const unit = /km/i.test(s) ? "KM" : /h(r|our)/i.test(s) ? "HOURS" : null;
  if (!/\d/.test(s)) return { value: null, unit, text: s };
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return { value: null, unit, text: s };
  return { value: n, unit, text: null };
}

/** Open WorkshopOne's database read-only. Never opened for writing. */
function openWorkshop(path: string) {
  return new Database(path, { readonly: true, fileMustExist: true });
}

export async function syncWorkshopServices(opts?: { dbPath?: string }): Promise<SyncResult> {
  const dbPath = opts?.dbPath || process.env.WORKSHOP_DB_PATH || DEFAULT_WORKSHOP_DB;
  const result: SyncResult = {
    ok: false, scanned: 0, created: 0, updated: 0, unchanged: 0, metersAdded: 0, metersRuledOut: 0,
    skippedNoMachine: 0, skippedNoDate: 0, migratedFromArchive: 0,
    platesFilled: 0, plateConflicts: [], unresolvedLabels: [],
  };

  let src: ReturnType<typeof openWorkshop>;
  try {
    src = openWorkshop(dbPath);
  } catch (err) {
    result.error = `cannot open the WorkshopOne database at ${dbPath}: ${(err as Error).message}`;
    return result;
  }

  try {
    const jobs = src.prepare(`SELECT id, legacy_service_id, vehicle_label, asset_id, service_date,
        job_no, meter_reading, next_service_meter, service_type, site_location, repair_details,
        parts_subtotal, labour_charge, sundry_amount, grand_total, upkeeping, reg_id
      FROM service_jobs ORDER BY id`).all() as WorkshopJob[];
    result.scanned = jobs.length;

    const wsAssets = new Map<number, { code: string; ec_code: string | null; registration: string | null }>(
      (src.prepare("SELECT id, code, ec_code, registration FROM assets").all() as {
        id: number; code: string; ec_code: string | null; registration: string | null;
      }[]).map((a) => [a.id, a])
    );

    // Oil and filter lines, grouped by job.
    const oils = src.prepare("SELECT service_id, oil_name, oil_type, action_type, qty, price FROM service_oils").all() as Record<string, unknown>[];
    const filters = src.prepare("SELECT service_id, category, filter_no, action_type, qty, price FROM service_filters").all() as Record<string, unknown>[];
    const oilsBy = new Map<number, Record<string, unknown>[]>();
    const filtersBy = new Map<number, Record<string, unknown>[]>();
    for (const o of oils) {
      const k = Number(o.service_id);
      (oilsBy.get(k) ?? oilsBy.set(k, []).get(k)!).push(o);
    }
    for (const f of filters) {
      const k = Number(f.service_id);
      (filtersBy.get(k) ?? filtersBy.set(k, []).get(k)!).push(f);
    }

    // Fuel-system side.
    const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true } });
    const byCode = new Map<string, (typeof assets)[number]>();
    const byReg = new Map<string, (typeof assets)[number]>();
    for (const a of assets) {
      if (a.code && !byCode.has(norm(a.code))) byCode.set(norm(a.code), a);
      if (a.regNo && !byReg.has(norm(a.regNo))) byReg.set(norm(a.regNo), a);
    }
    const look = (k: string) => byCode.get(k) ?? byReg.get(k) ?? null;
    const resolve = (j: WorkshopJob) => {
      const wa = j.asset_id != null ? wsAssets.get(j.asset_id) : undefined;
      if (wa) {
        const hit = look(norm(wa.ec_code)) ?? look(norm(wa.code)) ?? look(norm(wa.registration));
        if (hit) return hit;
      }
      if (j.reg_id) {
        const hit = look(norm(j.reg_id));
        if (hit) return hit;
      }
      if (j.vehicle_label) {
        for (const tok of String(j.vehicle_label).split(/[\s(),]+/).filter(Boolean)) {
          const hit = look(norm(tok));
          if (hit) return hit;
        }
      }
      return null;
    };

    const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
    if (!admin) throw new Error("no admin user to attribute synced records to");

    // One-time migration: records pulled from the 2026-08-10 archive are keyed
    // SRDB:<legacy id>. Re-key them onto WSO:<id> so this sync recognises them
    // as the same service rather than inserting a duplicate.
    const legacyToId = new Map<number, number>();
    for (const j of jobs) if (j.legacy_service_id != null) legacyToId.set(j.legacy_service_id, j.id);
    const archived = await prisma.serviceRecord.findMany({
      where: { sourceRef: { startsWith: "SRDB:" } },
      select: { id: true, sourceRef: true },
    });
    for (const rec of archived) {
      const legacyId = Number(rec.sourceRef!.slice(5));
      const liveId = legacyToId.get(legacyId);
      if (liveId == null) continue;
      const clash = await prisma.serviceRecord.findUnique({ where: { sourceRef: `WSO:${liveId}` }, select: { id: true } });
      if (clash) continue;
      await prisma.serviceRecord.update({ where: { id: rec.id }, data: { sourceRef: `WSO:${liveId}` } });
      result.migratedFromArchive++;
    }

    const existing = new Map(
      (await prisma.serviceRecord.findMany({
        where: { sourceRef: { startsWith: "WSO:" } },
        select: { id: true, sourceRef: true, serviceDate: true, meterAtService: true, costCents: true, assetId: true },
      })).map((r) => [r.sourceRef!, r])
    );

    const unresolved = new Set<string>();

    for (const j of jobs) {
      const day = String(j.service_date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { result.skippedNoDate++; continue; }
      const asset = resolve(j);
      if (!asset) {
        result.skippedNoMachine++;
        const wa = j.asset_id != null ? wsAssets.get(j.asset_id) : undefined;
        unresolved.add(wa?.code ?? j.reg_id ?? j.vehicle_label ?? `asset_id ${j.asset_id}`);
        continue;
      }

      const meter = parseWorkshopMeter(j.meter_reading);
      const next = parseWorkshopMeter(j.next_service_meter);
      const sourceRef = `WSO:${j.id}`;
      const noteParts: string[] = [];
      if (j.repair_details?.trim()) noteParts.push(j.repair_details.trim());
      if (meter.text) noteParts.push(`Meter at service recorded as "${meter.text}" — not a usable reading.`);

      const data = {
        assetId: asset.id,
        serviceDate: colombo(day),
        meterAtService: meter.value,
        meterType: asset.meterType,
        serviceType: j.service_type?.trim() || null,
        costCents: cents(j.grand_total),
        note: noteParts.length ? noteParts.join(" ") : null,
        jobNo: j.job_no?.trim() || null,
        partsCents: cents(j.parts_subtotal),
        labourCents: cents(j.labour_charge),
        sundryCents: cents(j.sundry_amount),
        location: j.site_location?.trim() || null,
        nextServiceMeter: next.value,
        condition: j.upkeeping?.trim() || null,
        sourceRef,
        recordedById: admin.id,
      };

      const prev = existing.get(sourceRef);
      let recordId: string;
      if (!prev) {
        const created = await prisma.serviceRecord.create({ data, select: { id: true } });
        recordId = created.id;
        result.created++;
      } else {
        const changed =
          prev.assetId !== data.assetId ||
          prev.serviceDate.getTime() !== data.serviceDate.getTime() ||
          prev.meterAtService !== data.meterAtService ||
          prev.costCents !== data.costCents;
        if (changed) {
          await prisma.serviceRecord.update({ where: { id: prev.id }, data });
          result.updated++;
        } else {
          result.unchanged++;
        }
        recordId = prev.id;
      }

      // Rebuild the part lines so an edit in WorkshopOne is reflected exactly.
      const oilLines = oilsBy.get(j.id) ?? [];
      const filterLines = filtersBy.get(j.id) ?? [];
      if (!prev || oilLines.length || filterLines.length) {
        await prisma.serviceItem.deleteMany({ where: { serviceRecordId: recordId } });
        for (const o of oilLines) {
          await prisma.serviceItem.create({
            data: {
              serviceRecordId: recordId, kind: "OIL",
              description: String(o.oil_name ?? o.oil_type ?? "Oil").trim() || "Oil",
              partNo: o.oil_type ? String(o.oil_type).trim() || null : null,
              action: o.action_type ? String(o.action_type).trim() || null : null,
              qty: Number(o.qty) || 1,
              unitPriceCents: cents(o.price),
              amountCents: cents((Number(o.price) || 0) * (Number(o.qty) || 1)),
            },
          });
        }
        for (const f of filterLines) {
          await prisma.serviceItem.create({
            data: {
              serviceRecordId: recordId, kind: "FILTER",
              description: String(f.category ?? "Filter").trim() || "Filter",
              partNo: f.filter_no ? String(f.filter_no).trim() || null : null,
              action: f.action_type ? String(f.action_type).trim() || null : null,
              qty: Number(f.qty) || 1,
              unitPriceCents: cents(f.price),
              amountCents: cents((Number(f.price) || 0) * (Number(f.qty) || 1)),
            },
          });
        }
      }

      // A meter read at a service is a real reading — put it in the meter
      // history, but only when it can be trusted. WorkshopOne's meter column has
      // carried values up to 15,651,010,099, and some machines have two meters.
      //
      // Readings the owner has ruled out by hand are dropped first. They have to
      // be excluded HERE rather than by editing the record, because the block
      // above rewrites meterAtService from WorkshopOne on every run.
      const ruledOut = DISTRUSTED_SERVICE_METERS.get(sourceRef);
      if (ruledOut) {
        result.metersRuledOut++;
      } else if (meter.value != null) {
        const already = await prisma.meterReading.findFirst({
          where: { assetId: asset.id, source: "SERVICE", value: meter.value, readingDate: data.serviceDate },
          select: { id: true },
        });
        if (!already) {
          const ref = await prisma.fuelIssue.aggregate({
            where: { assetId: asset.id, voided: false, meterReading: { gt: 0 } },
            _min: { meterReading: true }, _max: { meterReading: true },
          });
          const own = (await prisma.serviceRecord.findMany({
            where: { assetId: asset.id, meterAtService: { not: null } },
            orderBy: { serviceDate: "asc" }, select: { meterAtService: true },
          })).map((r) => r.meterAtService!) as number[];
          const check = checkServiceMeter({
            value: meter.value,
            meterType: asset.meterType,
            reference: ref._min.meterReading != null && ref._max.meterReading != null
              ? { min: ref._min.meterReading, max: ref._max.meterReading } : null,
            ownSequenceInDateOrder: own,
          });
          if (check.trusted) {
            await prisma.meterReading.create({
              data: {
                value: meter.value, readingType: asset.meterType, readingDate: data.serviceDate,
                source: "SERVICE", assetId: asset.id, recordedById: admin.id,
              },
            });
            result.metersAdded++;
          }
        }
      }
    }

    // ── registration numbers ────────────────────────────────────────────────
    // WorkshopOne's asset register also holds number plates, so a plate typed
    // there reaches this system too. Deliberately conservative: as of the first
    // run this fills NOTHING, because WorkshopOne's 285 registrations either
    // already agree with ours or are not plates at all ("FIORI", "14160" —
    // the latter shared by three machines). The value is forward-looking: when
    // the workshop records a real plate, it arrives here on the next sync.
    //
    // A plate is only written when ALL of these hold:
    //   - ours is blank, or is just the machine code repeated
    //   - theirs is not simply the machine code repeated either
    //   - it is shaped like a plate
    //   - no other machine already uses it, as a code or as a plate
    //   - WorkshopOne does not reuse it across several assets
    // A genuine disagreement (both hold a different plate) is never overwritten
    // — one of the two is a typo and only the vehicle book can settle it.
    const plateUse = new Map<string, number>();
    for (const a of wsAssets.values()) {
      const r = norm(a.registration);
      if (r) plateUse.set(r, (plateUse.get(r) ?? 0) + 1);
    }
    const allAssets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true } });
    const takenCodes = new Set(allAssets.map((a) => norm(a.code)));
    const takenPlates = new Set(allAssets.filter((a) => a.regNo).map((a) => norm(a.regNo)));

    for (const a of allAssets) {
      const ws =
        [...wsAssets.values()].find((x) => norm(x.ec_code) === norm(a.code)) ??
        [...wsAssets.values()].find((x) => norm(x.code) === norm(a.code));
      const theirs = (ws?.registration ?? "").trim();
      if (!theirs) continue;

      const ours = (a.regNo ?? "").trim();
      const oursIsPlaceholder = !ours || norm(ours) === norm(a.code);

      if (!oursIsPlaceholder) {
        if (norm(ours) !== norm(theirs)) {
          result.plateConflicts.push({ code: a.code, ours, workshopOne: theirs });
        }
        continue;
      }
      if (norm(theirs) === norm(a.code)) continue;          // tells us nothing new
      if (!PLATE_SHAPE.test(theirs)) continue;              // a model or serial, not a plate
      if ((plateUse.get(norm(theirs)) ?? 0) > 1) continue;  // reused in WorkshopOne
      if (takenCodes.has(norm(theirs))) continue;           // already a machine's code here
      if (takenPlates.has(norm(theirs))) continue;          // already another machine's plate

      await prisma.asset.update({ where: { id: a.id }, data: { regNo: theirs } });
      takenPlates.add(norm(theirs));
      result.platesFilled++;
    }

    result.unresolvedLabels = [...unresolved].sort();
    result.ok = true;
    return result;
  } catch (err) {
    result.error = (err as Error).message;
    return result;
  } finally {
    src.close();
  }
}
