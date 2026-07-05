"use client";

import React, { useState } from "react";
import { updateAssetAction, deleteAssetAction } from "@/app/actions/fleet";
import { useRouter } from "next/navigation";
import { Edit3, X, AlertTriangle, Trash2, CheckCircle2 } from "lucide-react";

interface AssetEditorProps {
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
  };
}

export default function AssetEditor({ asset }: AssetEditorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const openModal = () => {
    setIsOpen(true);
    setError(null);
    setSuccess(false);
    setShowDeleteConfirm(false);
  };

  const closeModal = () => {
    setIsOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const res = await updateAssetAction(asset.id, formData);

    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      setTimeout(() => {
        closeModal();
      }, 1500);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    const res = await deleteAssetAction(asset.id);

    setLoading(false);
    if (res.error) {
      setError(res.error);
      setShowDeleteConfirm(false);
    } else {
      setSuccess(true);
      setTimeout(() => {
        closeModal();
        router.push("/fleet");
      }, 1500);
    }
  };

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-2 bg-[#1b1e30] border border-white/5 hover:border-indigo-500/30 hover:bg-[#252943] text-gray-300 hover:text-white px-4 py-2 rounded-xl text-xs font-semibold tracking-wide active:scale-95 transition-all"
      >
        <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
        Edit Asset Specs
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="relative w-full max-w-2xl bg-[#121420] border border-white/5 rounded-2xl shadow-2xl p-6 md:p-8 max-h-[90vh] overflow-y-auto animate-slideUp">
            
            {/* Header */}
            <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
              <h2 className="text-base font-bold text-white tracking-wide">
                Edit Specifications for {asset.code}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/10 rounded-xl p-4 mb-4 text-xs text-red-200">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/10 rounded-xl p-4 mb-4 text-xs text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Asset details updated successfully!</span>
              </div>
            )}

            {!success && !showDeleteConfirm && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Brand */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Brand
                    </label>
                    <input
                      type="text"
                      name="brand"
                      defaultValue={asset.brand || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Model Number
                    </label>
                    <input
                      type="text"
                      name="model"
                      defaultValue={asset.model || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Type Label */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Type / Label
                    </label>
                    <input
                      type="text"
                      name="typeLabel"
                      defaultValue={asset.typeLabel || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Reg No */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Registration Number
                    </label>
                    <input
                      type="text"
                      name="regNo"
                      defaultValue={asset.regNo || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-mono"
                    />
                  </div>

                  {/* Capacity */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Capacity
                    </label>
                    <input
                      type="text"
                      name="capacity"
                      defaultValue={asset.capacity || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* YOM */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Year of Manufacture (YOM)
                    </label>
                    <input
                      type="number"
                      name="yom"
                      defaultValue={asset.yom || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Serial No */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Serial Number
                    </label>
                    <input
                      type="text"
                      name="serialNo"
                      defaultValue={asset.serialNo || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Chassis No */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Chassis Number
                    </label>
                    <input
                      type="text"
                      name="chassisNo"
                      defaultValue={asset.chassisNo || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Engine No */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Engine Number
                    </label>
                    <input
                      type="text"
                      name="engineNo"
                      defaultValue={asset.engineNo || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Site Location */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Current Site
                    </label>
                    <input
                      type="text"
                      name="site"
                      defaultValue={asset.site || ""}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Operational Status
                    </label>
                    <select
                      name="status"
                      defaultValue={asset.status}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive / Breakdown</option>
                    </select>
                  </div>

                  {/* Meter Type */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Metering Unit
                    </label>
                    <select
                      name="meterType"
                      defaultValue={asset.meterType}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
                    >
                      <option value="KM">Kilometres (KM)</option>
                      <option value="HOURS">Hours (HOURS)</option>
                    </select>
                  </div>

                  {/* Daily Fuel Cap */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Daily Fuel Cap (Litres)
                    </label>
                    <input
                      type="number"
                      name="dailyCapLitres"
                      min="1"
                      step="1"
                      defaultValue={asset.dailyCapLitres ?? ""}
                      placeholder="No cap"
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
                    />
                    <p className="text-[10px] text-gray-500 mt-1.5">
                      Leave blank for no limit. Blocks issues once the day's total would exceed this.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-between items-center border-t border-white/5 pt-4 mt-6">
                  {/* Delete trigger */}
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 font-semibold hover:underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Dispose Asset
                  </button>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md active:scale-95 disabled:opacity-50"
                    >
                      {loading ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Delete Confirmation View */}
            {showDeleteConfirm && (
              <div className="space-y-6 text-center py-6">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center text-red-400 mx-auto">
                  <AlertTriangle className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-md font-bold text-white tracking-wide">Are you absolutely sure?</h3>
                  <p className="text-xs text-gray-400 mt-2 max-w-md mx-auto">
                    This will soft-delete and mark asset <strong>{asset.code}</strong> as DISPOSED. All fuel issue and meter history remain intact for reports.
                  </p>
                </div>
                <div className="flex justify-center gap-3 border-t border-white/5 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold"
                  >
                    No, Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={loading}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-md active:scale-95 disabled:opacity-50"
                  >
                    {loading ? "Deleting..." : "Yes, Confirm Disposal"}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
