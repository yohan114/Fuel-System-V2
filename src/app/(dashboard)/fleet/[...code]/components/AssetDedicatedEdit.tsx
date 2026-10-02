"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateAssetAction, deleteAssetAction } from "@/app/actions/fleet";
import { ArrowLeft, Save, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface AssetDedicatedEditProps {
  asset: {
    id: string;
    code: string;
    brand: string | null;
    typeLabel: string | null;
    model: string | null;
    regNo: string | null;
    capacity: string | null;
    yom: number | null;
    chassisNo: string | null;
    engineNo: string | null;
    serialNo: string | null;
    site: string | null;
    status: string;
    meterType: string;
    dailyCapLitres: number | null;
    billFuelOnly: boolean;
    categoryId: string;
  };
  categories: { id: string; name: string; code: string }[];
}

export function AssetDedicatedEdit({ asset, categories }: AssetDedicatedEditProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    try {
      const res = await updateAssetAction(asset.id, formData);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push(`/fleet/${asset.code}`);
          router.refresh();
        }, 1000);
      }
    } catch {
      setError("Failed to update asset");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to mark ${asset.code} as DISPOSED?`)) return;
    setLoading(true);
    try {
      const res = await deleteAssetAction(asset.id);
      if (res.error) {
        setError(res.error);
      } else {
        router.push("/fleet");
      }
    } catch {
      setError("Failed to dispose asset");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/fleet/${asset.code}`}
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Back to {asset.code}
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 text-xs font-semibold transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" /> Dispose Machine
        </button>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            Edit Asset: {asset.code}
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Update specifications, meter units, daily cap limits, and site assignments.
          </p>
        </div>

        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-rose-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-emerald-400 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Asset updated successfully! Redirecting...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Asset Code (Unique Identifier)
              </label>
              <input
                type="text"
                disabled
                value={asset.code}
                className="w-full bg-[#1b1e30]/50 border border-white/5 rounded-xl px-3 py-2 text-xs text-gray-400 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Category
              </label>
              <select
                name="categoryId"
                defaultValue={asset.categoryId}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Make / Brand</label>
              <input
                type="text"
                name="brand"
                defaultValue={asset.brand || ""}
                placeholder="e.g. Caterpillar, Komatsu, Isuzu"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Model</label>
              <input
                type="text"
                name="model"
                defaultValue={asset.model || ""}
                placeholder="e.g. 320D, PC200, GIGA"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Registration #</label>
              <input
                type="text"
                name="regNo"
                defaultValue={asset.regNo || ""}
                placeholder="e.g. WP-CAT-0088"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Type Label</label>
              <input
                type="text"
                name="typeLabel"
                defaultValue={asset.typeLabel || ""}
                placeholder="e.g. Hydraulic Excavator"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Meter Type</label>
              <select
                name="meterType"
                defaultValue={asset.meterType}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="KM">Kilometres (KM)</option>
                <option value="HOURS">Hours (HOURS)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Default Site</label>
              <input
                type="text"
                name="site"
                defaultValue={asset.site || ""}
                placeholder="e.g. Kotugoda, Badalgama"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Daily Fuel Cap (Litres)
              </label>
              <input
                type="number"
                name="dailyCapLitres"
                defaultValue={asset.dailyCapLitres || ""}
                placeholder="Leave blank for uncapped"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Year of Manufacture</label>
              <input
                type="number"
                name="yom"
                defaultValue={asset.yom || ""}
                placeholder="e.g. 2018"
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Chassis #</label>
              <input
                type="text"
                name="chassisNo"
                defaultValue={asset.chassisNo || ""}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Engine #</label>
              <input
                type="text"
                name="engineNo"
                defaultValue={asset.engineNo || ""}
                className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-white/5">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="billFuelOnly"
                defaultChecked={asset.billFuelOnly}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-semibold text-gray-300">
                Fuel-Only Machine (Bill only fuel disbursements without rental hire charges)
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
            <Link
              href={`/fleet/${asset.code}`}
              className="px-4 py-2 text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
