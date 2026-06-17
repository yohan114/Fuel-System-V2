import React from "react";
import { getBillingConfig } from "@/lib/billing/config";
import { updateBillingSettingsAction } from "@/app/actions/billing";
import { Receipt, Clock, Percent } from "lucide-react";

const input =
  "w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50";
const label = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2";

export default async function AdminBillingPage() {
  const cfg = await getBillingConfig();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-indigo-400" /> Billing Configuration
        </h3>
        <p className="text-xs text-gray-400">
          Defaults used when generating monthly bills. Tax rates are snapshotted onto each bill at generation time.
        </p>
      </div>

      <form
        action={async (formData) => {
          "use server";
          await updateBillingSettingsAction(formData);
        }}
        className="space-y-5"
      >
        {/* Automation */}
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" /> Automation
          </h4>
          <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
            <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="accent-indigo-500 w-4 h-4" />
            Enable automatic monthly generation
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Cron Schedule</label>
              <input name="cron" defaultValue={cfg.cron} className={input} />
              <p className="text-[10px] text-gray-500 mt-1">Default <code>0 3 1 * *</code> — 03:00 on the 1st (bills the previous month).</p>
            </div>
            <div>
              <label className={label}>Invoice Number Prefix</label>
              <input name="invoicePrefix" defaultValue={cfg.invoicePrefix} className={input} />
            </div>
          </div>
          <p className="text-[10px] text-gray-500">
            An external scheduler must call <code>GET /api/cron/billing?secret=&lt;CRON_SECRET&gt;</code> on this schedule
            (same model as the scraper / backup jobs).
          </p>
        </div>

        {/* Minimums */}
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Guaranteed Minimums</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={label}>Minimum Hours</label>
              <input type="number" name="minHours" step="1" min="0" defaultValue={cfg.minHours} className={input} />
            </div>
            <div>
              <label className={label}>Minimum KM</label>
              <input type="number" name="minKm" step="1" min="0" defaultValue={cfg.minKm} className={input} />
            </div>
            <div>
              <label className={label}>Minimum Days</label>
              <input type="number" name="minDays" step="1" min="0" defaultValue={cfg.minDays} className={input} />
            </div>
          </div>
        </div>

        {/* Taxes & terms */}
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Percent className="w-4 h-4 text-amber-400" /> Taxes & Terms
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={label}>SSCL (%)</label>
              <input type="number" name="ssclPct" step="0.1" min="0" defaultValue={(cfg.ssclRate * 100).toFixed(2)} className={input} />
            </div>
            <div>
              <label className={label}>VAT (%)</label>
              <input type="number" name="vatPct" step="0.1" min="0" defaultValue={(cfg.vatRate * 100).toFixed(2)} className={input} />
            </div>
            <div>
              <label className={label}>Payment Terms (Due Days)</label>
              <input type="number" name="dueDays" step="1" min="0" defaultValue={cfg.dueDays} className={input} />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
        >
          Save Billing Settings
        </button>
      </form>
    </div>
  );
}
