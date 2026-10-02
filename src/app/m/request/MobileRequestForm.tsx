"use client";

import React, { useState, useTransition } from "react";
import { submitRequestAction } from "@/app/actions/fuel";
import { PlusCircle, Camera, Check, AlertCircle, Search, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";

interface AssetOption {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
}

export default function MobileRequestForm({ assets }: { assets: AssetOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [fuelKind, setFuelKind] = useState("AUTO_DIESEL");
  const [requestedLitres, setRequestedLitres] = useState("");
  const [meterReading, setMeterReading] = useState("");
  const [reason, setReason] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  const filteredAssets = searchQuery.trim()
    ? assets
        .filter(
          (a) =>
            a.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (a.regNo && a.regNo.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        .slice(0, 10)
    : assets.slice(0, 8);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    }
  };

  const addLitres = (amount: number) => {
    const current = parseFloat(requestedLitres) || 0;
    setRequestedLitres((current + amount).toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedAssetId) {
      setErrorMessage("Please select a vehicle or asset");
      return;
    }

    const litresNum = parseFloat(requestedLitres);
    if (!litresNum || litresNum <= 0) {
      setErrorMessage("Please enter valid litres");
      return;
    }

    const formData = new FormData();
    formData.append("assetId", selectedAssetId);
    formData.append("fuelKind", fuelKind);
    formData.append("requestedLitres", requestedLitres);
    if (meterReading) formData.append("meterReading", meterReading);
    if (reason) formData.append("reason", reason);
    if (photoFile) formData.append("photo", photoFile);

    startTransition(async () => {
      try {
        const res = await submitRequestAction(formData);
        if (res.error) {
          setErrorMessage(res.error);
        } else {
          setSuccessMessage(
            `Request for ${requestedLitres} L submitted for ${selectedAsset?.code}!`
          );
          setRequestedLitres("");
          setMeterReading("");
          setReason("");
          setPhotoFile(null);
          setPhotoPreview(null);
          router.refresh();
        }
      } catch (err) {
        setErrorMessage("Network or server error while submitting request");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 1. Vehicle Selection */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
          1. Vehicle / Equipment
        </label>

        {selectedAsset ? (
          <div className="flex items-center justify-between p-3 rounded-xl bg-blue-600/10 border border-blue-500/40">
            <div>
              <div className="text-base font-bold text-white tracking-wide font-mono">
                {selectedAsset.code}
              </div>
              <div className="text-xs text-slate-400">
                {selectedAsset.regNo ? `${selectedAsset.regNo} • ` : ""}
                Meter: <span className="font-semibold text-blue-300">{selectedAsset.meterType}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAssetId("")}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code (e.g. DT-123, HEX...)"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setSelectedAssetId(asset.id)}
                  className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-blue-500/50 text-left active:bg-blue-600/20 transition-colors"
                >
                  <div className="font-bold text-xs text-white font-mono">
                    {asset.code}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {asset.regNo || asset.meterType}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Fuel Kind */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
          2. Fuel Kind
        </label>
        <div className="grid grid-cols-2 gap-2">
          {["AUTO_DIESEL", "SUPER_DIESEL"].map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setFuelKind(kind)}
              className={`p-3 rounded-xl border text-center font-bold text-xs tracking-wide transition-all ${
                fuelKind === kind
                  ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/20"
                  : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              {kind.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Requested Litres */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
          3. Requested Litres
        </label>

        <div className="relative">
          <input
            type="number"
            step="0.1"
            min="0.1"
            required
            value={requestedLitres}
            onChange={(e) => setRequestedLitres(e.target.value)}
            placeholder="0.0"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-2xl font-mono font-bold text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 text-center"
          />
          <span className="absolute right-4 top-4 text-sm font-bold text-slate-500">
            Litres
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {[10, 25, 50, 100].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => addLitres(amt)}
              className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono font-semibold text-slate-200 active:scale-95 transition-all"
            >
              +{amt}L
            </button>
          ))}
        </div>
      </div>

      {/* 4. Meter & Reason */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
            4. Current Meter ({selectedAsset?.meterType || "KM/HOURS"})
          </label>
          <input
            type="number"
            step="0.1"
            value={meterReading}
            onChange={(e) => setMeterReading(e.target.value)}
            placeholder="e.g. 14250.0"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-base font-mono text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
            Reason / Purpose (Optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Site earthwork batch draw"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
            Meter / Running Chart Photo (Optional)
          </label>
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-slate-700 hover:border-blue-500 bg-slate-950 hover:bg-slate-900 text-slate-300 text-xs font-medium transition-colors">
              <Camera className="w-5 h-5 text-blue-400" />
              <span>{photoFile ? "Change Photo" : "Upload / Camera"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </label>

            {photoPreview && (
              <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Proof preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  className="absolute -top-1 -right-1 p-0.5 bg-red-600 text-white rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full py-4 rounded-2xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-600/30 active:scale-[0.98] transition-all"
      >
        {isPending ? (
          <>
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Submitting Request...</span>
          </>
        ) : (
          <>
            <PlusCircle className="w-5 h-5" />
            <span>SUBMIT REQUEST</span>
          </>
        )}
      </button>
    </form>
  );
}
