"use client";

import React, { useState } from "react";
import { submitRequestAction, recordDirectIssueAction } from "@/app/actions/fuel";
import { addReadingAction } from "@/app/actions/readings";
import { Plus, X, Fuel, FileText, Gauge, AlertCircle, CheckCircle } from "lucide-react";

interface AssetProp {
  id: string;
  code: string;
  meterType: string;
  regNo: string | null;
}

interface QuickActionsProps {
  assets: AssetProp[];
  isAdmin: boolean;
  isLocked: boolean;
}

export default function QuickActions({ assets, isAdmin, isLocked }: QuickActionsProps) {
  const [activeModal, setActiveModal] = useState<"request" | "issue" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [needsOverride, setNeedsOverride] = useState<boolean>(false);
  
  // Selected asset state to show correct meter placeholder dynamically
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>("");
  const selectedAsset = assets.find(a => a.code.toUpperCase() === selectedAssetCode.toUpperCase() || a.id === selectedAssetCode);

  const openModal = (type: "request" | "issue" | "reading") => {
    setActiveModal(type);
    setError(null);
    setSuccess(false);
    setLoading(false);
    setNeedsOverride(false);
    setSelectedAssetCode(assets[0]?.code || "");
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  const handleRequestSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    const formData = new FormData(e.currentTarget);
    try {
      const res = await submitRequestAction(formData);
      
      setLoading(false);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeModal();
        }, 1500);
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "An unexpected network or system error occurred.");
    }
  };

  const handleIssueSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    const formData = new FormData(e.currentTarget);
    try {
      const res = await recordDirectIssueAction(formData);
      
      setLoading(false);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeModal();
        }, 1500);
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "An unexpected network or system error occurred.");
    }
  };

  const handleReadingSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    const formData = new FormData(e.currentTarget);
    if (needsOverride) {
      formData.set("adminOverride", "true");
    }

    try {
      const res = await addReadingAction(formData);
      
      setLoading(false);
      if (res.error) {
        setError(res.error);
        if (res.needsOverrideOption) {
          setNeedsOverride(true);
        }
      } else {
        setSuccess(true);
        setTimeout(() => {
          closeModal();
        }, 1500);
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "An unexpected network or system error occurred.");
    }
  };

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-4">
        {/* Trigger Request */}
        <button
          disabled={isLocked}
          onClick={() => openModal("request")}
          className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-indigo-500/30 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-5 py-3.5 rounded-xl text-sm font-semibold tracking-wide shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
        >
          <FileText className="w-4 h-4 text-indigo-400" />
          Request Fuel
        </button>

        {/* Trigger Direct Issue (Admin only) */}
        {isAdmin && (
          <button
            disabled={isLocked}
            onClick={() => openModal("issue")}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white px-5 py-3.5 rounded-xl text-sm font-semibold tracking-wide shadow-lg shadow-indigo-500/15 active:scale-95 disabled:from-indigo-600/50 disabled:to-indigo-600/50 disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            <Fuel className="w-4 h-4 text-white" />
            Direct Issue
          </button>
        )}

        {/* Trigger Meter Reading */}
        <button
          disabled={isLocked}
          onClick={() => openModal("reading")}
          className="flex items-center gap-2 bg-[#121420] border border-white/5 hover:border-emerald-500/30 hover:bg-[#1b1e30] text-gray-300 hover:text-white px-5 py-3.5 rounded-xl text-sm font-semibold tracking-wide shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
        >
          <Gauge className="w-4 h-4 text-emerald-400" />
          Log Reading
        </button>

        {/* Locked warning message */}
        {isLocked && (
          <span className="text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/15 px-3 py-2.5 rounded-xl flex items-center gap-1.5 animate-pulse">
            🔒 Operations Closed (08:00 AM – 17:00 PM only)
          </span>
        )}
      </div>

      {/* MODAL DIALOG CONTAINER */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="relative w-full max-w-lg bg-[#121420] border border-white/5 rounded-2xl shadow-2xl p-6 md:p-8 animate-slideUp">
            
            {/* Header */}
            <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                {activeModal === "request" && (
                  <>
                    <FileText className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-lg font-bold text-white tracking-wide">Request Fuel</h2>
                  </>
                )}
                {activeModal === "issue" && (
                  <>
                    <Fuel className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-lg font-bold text-white tracking-wide">Record Direct Fuel Issue</h2>
                  </>
                )}
                {activeModal === "reading" && (
                  <>
                    <Gauge className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-lg font-bold text-white tracking-wide">Log Meter Reading</h2>
                  </>
                )}
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error/Success banners */}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/10 rounded-xl p-4 mb-4">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-200">{error}</div>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/10 rounded-xl p-4 mb-4">
                <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <span className="text-sm text-emerald-200">Operation logged successfully!</span>
              </div>
            )}

            {/* Form body */}
            {!success && (
              <form
                onSubmit={
                  activeModal === "request"
                    ? handleRequestSubmit
                    : activeModal === "issue"
                    ? handleIssueSubmit
                    : handleReadingSubmit
                }
                className="space-y-4"
              >
                {/* Asset Dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Select Asset (E&C No)
                  </label>
                  <input
                    type="text"
                    name="assetId"
                    value={selectedAssetCode}
                    onChange={(e) => setSelectedAssetCode(e.target.value)}
                    list="asset-list-options"
                    required
                    placeholder="Search or type E&C No (e.g. DT-123)"
                    className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                  />
                  <datalist id="asset-list-options">
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.code}>
                        {asset.code} {asset.regNo ? ` - ${asset.regNo}` : ""} ({asset.meterType})
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* Fuel Request / Issue fields */}
                {(activeModal === "request" || activeModal === "issue") && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Fuel Kind
                      </label>
                      <select
                        name="fuelKind"
                        required
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50"
                      >
                        <option value="AUTO_DIESEL">Auto Diesel</option>
                        <option value="SUPER_DIESEL">Super Diesel</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Litres
                      </label>
                      <input
                        type="number"
                        name={activeModal === "request" ? "requestedLitres" : "litres"}
                        step="0.01"
                        min="0.01"
                        required
                        placeholder="e.g. 45.5"
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                  </div>
                )}

                {/* Meter Reading details */}
                {activeModal === "reading" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Meter Value ({selectedAsset?.meterType})
                      </label>
                      <input
                        type="number"
                        name="value"
                        step="0.1"
                        min="0"
                        required
                        placeholder={`Reading in ${selectedAsset?.meterType}`}
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Reading Date
                      </label>
                      <input
                        type="date"
                        name="readingDate"
                        required
                        defaultValue={new Date().toISOString().split("T")[0]}
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* Meter Reading inside Fuel flow */}
                {(activeModal === "request" || activeModal === "issue") && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Meter Reading (Optional, {selectedAsset?.meterType})
                    </label>
                    <input
                      type="number"
                      name="meterReading"
                      step="0.1"
                      placeholder={`Current cumulative ${selectedAsset?.meterType}`}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50"
                    />
                  </div>
                )}

                {/* Pump / meter photo proof */}
                {(activeModal === "request" || activeModal === "issue") && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Pump / Meter Photo (Optional)
                    </label>
                    <input
                      type="file"
                      name="photo"
                      accept="image/*"
                      capture="environment"
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-2.5 text-white text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-white file:text-xs focus:outline-none"
                    />
                    <p className="text-[10px] text-gray-500 mt-1">Photo of the pump receipt / odometer as proof.</p>
                  </div>
                )}

                {/* Additional details for Direct Issue */}
                {activeModal === "issue" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Fuel Source
                      </label>
                      <select
                        name="source"
                        required
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none"
                      >
                        <option value="STATION">Fuel Station</option>
                        <option value="BOWSER">Bowser</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Issue Date
                      </label>
                      <input
                        type="datetime-local"
                        name="issueDate"
                        required
                        defaultValue={new Date().toISOString().substring(0, 16)}
                        className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* Reason for request */}
                {activeModal === "request" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Reason / Note
                    </label>
                    <textarea
                      name="reason"
                      placeholder="Specify site or reason for fuel requirement"
                      rows={2}
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/50 resize-none"
                    />
                  </div>
                )}

                {/* Admin override checkbox for backward meter readings */}
                {needsOverride && (
                  <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/10 rounded-xl p-4 my-2">
                    <input
                      type="checkbox"
                      id="overrideCheck"
                      checked={needsOverride}
                      onChange={(e) => setNeedsOverride(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-0 focus:outline-none border-white/10"
                    />
                    <label htmlFor="overrideCheck" className="text-xs text-yellow-200">
                      Bypass cumulative warning and force save reading (Admin Override)
                    </label>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3 border-t border-white/5 pt-4 mt-6">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-sm font-semibold tracking-wide active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold tracking-wide shadow-md active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center min-w-28"
                  >
                    {loading ? (
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      "Submit"
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
