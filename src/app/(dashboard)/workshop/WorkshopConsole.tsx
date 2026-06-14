"use client";

import React, { useState, useTransition } from "react";
import { submitBulkRequestAction, workshopIssueFuelAction } from "@/app/actions/workshop";
import { 
  Database, 
  Plus, 
  Fuel, 
  Clock, 
  CheckCircle, 
  AlertTriangle, 
  HelpCircle, 
  TrendingDown, 
  PlusCircle, 
  ShieldAlert, 
  RefreshCw,
  Search,
  Gauge,
  X
} from "lucide-react";

interface TankProp {
  id: string;
  name: string;
  fuelKind: string;
  balance: number;
  capacity: number;
}

interface AssetProp {
  id: string;
  code: string;
  regNo: string | null;
  meterType: string;
}

interface IssueProp {
  id: string;
  fuelKind: string;
  litres: number;
  meterReading: number | null;
  readingType: string | null;
  totalCost: number;
  issueDate: Date;
  asset: {
    code: string;
  };
  issuedBy: {
    name: string;
  };
}

interface BulkReqProp {
  id: string;
  fuelKind: string;
  requestedLitres: number;
  status: string;
  createdAt: Date;
  reviewNote: string | null;
}

interface ProjectProp {
  id: string;
  name: string;
  code: string;
}

interface WorkshopConsoleProps {
  currentTank: TankProp | null;
  allTanks: TankProp[];
  assets: AssetProp[];
  recentIssues: IssueProp[];
  bulkRequests: BulkReqProp[];
  projects: ProjectProp[];
  role: string;
  isLocked: boolean;
  lockMessage: string;
  todayStr: string;
  minDateStr: string;
}

export default function WorkshopConsole({
  currentTank: initialTank,
  allTanks,
  assets,
  recentIssues: initialIssues,
  bulkRequests: initialRequests,
  projects,
  role,
  isLocked,
  lockMessage,
  todayStr,
  minDateStr
}: WorkshopConsoleProps) {
  const [activeTank, setActiveTank] = useState<TankProp | null>(initialTank);
  const [issues, setIssues] = useState<IssueProp[]>(initialIssues);
  const [requests, setRequests] = useState<BulkReqProp[]>(initialRequests);
  const [isPending, startTransition] = useTransition();

  const [activeModal, setActiveModal] = useState<"replenish" | "issue" | "site-issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  
  // Selected asset state for form placeholder helpers
  const [selectedAssetCode, setSelectedAssetCode] = useState<string>("");
  const selectedAsset = assets.find(
    a => a.code.toUpperCase() === selectedAssetCode.toUpperCase() || a.id === selectedAssetCode
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");



  const openModal = (type: "replenish" | "issue" | "site-issue") => {
    setActiveModal(type);
    setError(null);
    setSuccess(false);
    setSelectedAssetCode("");
    setSelectedProjectId("");
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  const handleSiteIssueSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const targetProjectId = formData.get("projectId")?.toString() || "";
    const matchedProject = projects.find(p => p.id === targetProjectId);
    if (!matchedProject) {
      setError("Please select a valid project site.");
      return;
    }

    const assetCode = `SITE-${matchedProject.code}`;
    formData.set("assetId", assetCode);

    startTransition(async () => {
      try {
        const res = await workshopIssueFuelAction(formData);
        if (res.error) {
          setError(res.error);
        } else {
          setSuccess(true);
          const litres = parseFloat(formData.get("litres")?.toString() || "0");
          const formDateStr = formData.get("issueDate")?.toString();
          const optimisticDate = formDateStr ? new Date(formDateStr) : new Date();

          // Decrement local balance in UI state
          if (activeTank) {
            setActiveTank(prev => prev ? { ...prev, balance: prev.balance - litres } : null);
          }

          // Add optimistic issue in UI
          setIssues(prev => [
            {
              id: Math.random().toString(),
              fuelKind: activeTank?.fuelKind || "AUTO_DIESEL",
              litres,
              meterReading: null,
              readingType: "KM",
              totalCost: 0,
              issueDate: optimisticDate,
              asset: { code: assetCode },
              issuedBy: { name: "Current Operator" },
            },
            ...prev,
          ]);

          setTimeout(() => closeModal(), 1500);
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected network or system error occurred.");
      }
    });
  };

  const handleReplenishSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    if (activeTank) {
      formData.set("bulkTankId", activeTank.id);
    }

    startTransition(async () => {
      try {
        const res = await submitBulkRequestAction(formData);
        if (res.error) {
          setError(res.error);
        } else {
          setSuccess(true);
          // Add optimistic request in UI
          const litres = parseFloat(formData.get("requestedLitres")?.toString() || "0");
          setRequests(prev => [
            {
              id: Math.random().toString(),
              fuelKind: activeTank?.fuelKind || "AUTO_DIESEL",
              requestedLitres: litres,
              status: "PENDING",
              createdAt: new Date(),
              reviewNote: null,
            },
            ...prev,
          ]);
          setTimeout(() => closeModal(), 1500);
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected network or system error occurred.");
      }
    });
  };

  const handleIssueSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const res = await workshopIssueFuelAction(formData);
        if (res.error) {
          setError(res.error);
        } else {
          setSuccess(true);
          const litres = parseFloat(formData.get("litres")?.toString() || "0");
          const assetCode = formData.get("assetId")?.toString().toUpperCase() || "UNKNOWN";
          const meterReadingStr = formData.get("meterReading")?.toString();
          const meterReading = meterReadingStr ? parseFloat(meterReadingStr) : null;
          const formDateStr = formData.get("issueDate")?.toString();
          const optimisticDate = formDateStr ? new Date(formDateStr) : new Date();

          // Decrement local balance in UI state
          if (activeTank) {
            setActiveTank(prev => prev ? { ...prev, balance: prev.balance - litres } : null);
          }

          // Add optimistic issue in UI
          setIssues(prev => [
            {
              id: Math.random().toString(),
              fuelKind: activeTank?.fuelKind || "AUTO_DIESEL",
              litres,
              meterReading,
              readingType: selectedAsset?.meterType || "KM",
              totalCost: 0,
              issueDate: optimisticDate,
              asset: { code: assetCode },
              issuedBy: { name: "Current Operator" },
            },
            ...prev,
          ]);

          setTimeout(() => closeModal(), 1500);
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected network or system error occurred.");
      }
    });
  };

  if (!activeTank) {
    return (
      <div className="bg-[#121420] border border-white/5 p-8 rounded-2xl text-center space-y-4 shadow-xl max-w-xl mx-auto">
        <ShieldAlert className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-lg font-bold text-white uppercase tracking-wider">Storage Pump Not Assigned</h2>
        <p className="text-xs text-gray-400">
          This workshop operator account is not linked to any storage pump. 
          Please contact a system administrator to allocate a tank in the Admin Users panel.
        </p>
      </div>
    );
  }

  const percent = Math.min(100, Math.max(0, (activeTank.balance / activeTank.capacity) * 100));

  return (
    <div className="space-y-8">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">Workshop Pump Console</h1>
          <p className="text-xs text-gray-400 mt-1 capitalize">
            Manage dispatch inventories and vehicle fillings for **{activeTank.name}**.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold ${
              isLocked 
                ? "bg-red-500/10 text-red-400 border border-red-500/15" 
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/15"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{lockMessage}</span>
          </div>

          <button
            disabled={isLocked}
            onClick={() => openModal("replenish")}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-200 border border-white/5 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all w-fit"
          >
            <PlusCircle className="w-4 h-4 text-indigo-400" />
            Request Bulk replenishment
          </button>
          
          <button
            onClick={() => openModal("issue")}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide shadow-md active:scale-95 disabled:from-indigo-600/50 disabled:to-indigo-600/50 disabled:opacity-40 disabled:pointer-events-none transition-all w-fit"
          >
            <Fuel className="w-4 h-4" />
            Issue Fuel to Vehicle
          </button>

          <button
            onClick={() => openModal("site-issue")}
            className="flex items-center gap-2 bg-[#121420] hover:bg-[#1b1e30] border border-white/5 text-gray-200 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all w-fit"
          >
            <Database className="w-4 h-4 text-indigo-400" />
            Issue Fuel to Project Site
          </button>
        </div>
      </div>

      {/* Main Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Pump Fuel Inventory Progress card */}
        <div className="lg:col-span-2 bg-[#121420] border border-white/5 p-6 rounded-2xl shadow-xl flex flex-col justify-between space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <span className="text-gray-400 text-[10px] uppercase font-bold tracking-wider block">Pump Storage Balance</span>
                <span className="text-white font-bold text-sm block mt-0.5">{activeTank.name}</span>
              </div>
            </div>
            <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/10 text-indigo-400 px-3 py-1 rounded-lg font-bold uppercase tracking-wider">
              {activeTank.fuelKind.replace("_", " ")}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-baseline text-xs text-gray-400 font-semibold">
              <span className="text-xl font-bold text-white">{activeTank.balance.toLocaleString(undefined, { maximumFractionDigits: 1 })} L</span>
              <span>Capacity: {activeTank.capacity.toLocaleString()} L</span>
            </div>
            
            <div className="w-full bg-white/5 h-3.5 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-full rounded-full transition-all duration-500 shadow" 
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] text-gray-500 font-semibold pt-1">
              <span>{percent.toFixed(0)}% full</span>
              <span>Available Space: {(activeTank.capacity - activeTank.balance).toLocaleString(undefined, { maximumFractionDigits: 1 })} L</span>
            </div>
          </div>
        </div>

        {/* Local Fuel Pump Scrap Info */}
        <div className="bg-[#121420] border border-white/5 p-6 rounded-2xl shadow-xl flex flex-col justify-between">
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Operator Instructions</h4>
            <ul className="text-[11px] text-gray-400 space-y-2 list-disc pl-4 leading-relaxed font-medium">
              <li>You can refuel <strong>any vehicle or machinery</strong> in the E&C fleet.</li>
              <li>Dispatched quantities are automatically deducted from your pump storage.</li>
              <li>If the fuel level is low, request a bulk replenishment immediately.</li>
              <li>Type custom asset codes to auto-create unregistered items under "OTHER".</li>
            </ul>
          </div>
          <div className="text-[9px] text-gray-500 font-bold border-t border-white/5 pt-3 mt-4">
            BADALGAMA MAIN WORKSHOP LOGGING STATION ACTIVE
          </div>
        </div>

      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Dispatches list */}
        <div className="bg-[#121420] border border-white/5 p-6 rounded-2xl shadow-lg space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/5 pb-3 flex items-center gap-2">
            <Fuel className="w-4 h-4 text-indigo-400" />
            Recent Pump Dispatches
          </h3>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {issues.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">No dispatches logged yet.</div>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{issue.asset.code}</span>
                      <span className="text-[10px] text-gray-400 font-semibold">({issue.litres}L)</span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">
                      Issued to {issue.asset.code} • {new Date(issue.issueDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-gray-400 font-semibold text-[10px]">
                      {issue.meterReading !== null ? `${issue.meterReading.toLocaleString()} ${issue.readingType}` : "No meter"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Replenishment requests list */}
        <div className="bg-[#121420] border border-white/5 p-6 rounded-2xl shadow-lg space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/5 pb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            Replenishment History
          </h3>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {requests.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">No requests submitted yet.</div>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="p-3.5 bg-white/5 rounded-xl border border-white/5 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white text-sm">
                      {req.requestedLitres.toLocaleString()} L
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">
                      Submitted: {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                    req.status === "APPROVED"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : req.status === "REJECTED"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {req.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* ================= MODAL DIALOGS ================= */}

      {/* Modal 1: Request Bulk Replenishment */}
      {activeModal === "replenish" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative">
            <button
              onClick={closeModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-indigo-400" />
              Request Bulk Refuel
            </h3>
            <p className="text-xs text-gray-400">
              Submit a fuel request to load bulk inventory into <strong>{activeTank.name}</strong>. Admins must authorize the delivery.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Request submitted successfully! Waiting for admin review.</span>
              </div>
            )}

            <form onSubmit={handleReplenishSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Fuel Kind
                </label>
                <input
                  type="text"
                  readOnly
                  value={activeTank.fuelKind.replace("_", " ")}
                  className="w-full bg-[#1b1e30]/50 border border-white/5 rounded-xl px-3 py-2.5 text-gray-400 text-xs font-semibold uppercase"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Replenishment Litres
                </label>
                <input
                  type="number"
                  name="requestedLitres"
                  required
                  step="any"
                  placeholder="e.g. 5000"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Submit Bulk Request
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Issue Fuel drawing from local BulkTank balance */}
      {activeModal === "issue" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative">
            <button
              onClick={closeModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Fuel className="w-5 h-5 text-indigo-400" />
              Workshop Vehicle Refuel
            </h3>
            <p className="text-xs text-gray-400">
              Draw fuel from the <strong>{activeTank.name}</strong> balance (Remaining: {activeTank.balance.toFixed(1)}L).
            </p>

            {isLocked && (
              <div className="bg-amber-500/10 border border-amber-500/15 text-amber-400 text-xs px-4 py-3 rounded-xl flex items-start gap-2">
                <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" />
                <div>
                  <span className="font-bold block text-amber-300">🔒 After-Hours Dispatch Mode</span>
                  Only issues for <strong className="text-white">Vehicle Breakdown</strong> or <strong className="text-white">Active Night Work</strong> are permitted at this time.
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Fuel issue recorded and balance updated successfully!</span>
              </div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              
              {/* Asset Search Combobox */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Select Asset (E&C No or Reg No)
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    name="assetId"
                    required
                    list="workshop-asset-suggestions"
                    placeholder="Search by code or registration plate..."
                    value={selectedAssetCode}
                    onChange={(e) => setSelectedAssetCode(e.target.value)}
                    className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-bold"
                  />
                  <datalist id="workshop-asset-suggestions">
                    {assets.map((a) => (
                      <option key={a.id} value={a.code}>
                        {a.code} {a.regNo ? `• ${a.regNo}` : ""} ({a.meterType})
                      </option>
                    ))}
                  </datalist>
                </div>
                {selectedAsset && (
                  <span className="text-[10px] text-indigo-400 block mt-1.5 font-bold uppercase tracking-wider">
                    Resolved: {selectedAsset.code} {selectedAsset.regNo ? `[${selectedAsset.regNo}]` : ""} ({selectedAsset.meterType} Meter)
                  </span>
                )}
              </div>

              {/* Dispatch Date */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Dispatch Date (defaults to today)
                </label>
                <input
                  type="date"
                  name="issueDate"
                  required
                  defaultValue={todayStr}
                  min={minDateStr}
                  max={todayStr}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                />
              </div>

              {/* Litres */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Litres Issued
                </label>
                <input
                  type="number"
                  name="litres"
                  required
                  step="any"
                  placeholder="e.g. 80"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              {/* Odometer */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {selectedAsset ? `${selectedAsset.meterType} Reading` : "Odometer / Hour Meter"} (Optional)
                </label>
                <div className="relative">
                  <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="number"
                    name="meterReading"
                    step="any"
                    placeholder={selectedAsset ? `Current cumulative ${selectedAsset.meterType.toLowerCase()}...` : "Current reading..."}
                    className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs focus:outline-none"
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                {isLocked ? (
                  <>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Reason for After-Hours Issue <span className="text-red-400 font-bold">*</span>
                    </label>
                    <select
                      name="reason"
                      required
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                    >
                      <option value="Vehicle Breakdown">Vehicle Breakdown</option>
                      <option value="Active Night Work">Active Night Work</option>
                    </select>
                  </>
                ) : (
                  <>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Remarks / Reason (Optional)
                    </label>
                    <input
                      type="text"
                      name="reason"
                      placeholder="e.g. Badalgama maintenance test run"
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                    />
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Dispatch
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Issue Fuel to Project Site */}
      {activeModal === "site-issue" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-[#121420] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 relative">
            <button
              onClick={closeModal}
              className="absolute right-4 top-4 text-gray-400 hover:text-white hover:bg-white/5 p-1.5 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-400" />
              Project Site Fuel Dispatch
            </h3>
            <p className="text-xs text-gray-400">
              Dispatch bulk fuel to another project site from <strong>{activeTank.name}</strong> (Available: {activeTank.balance.toFixed(1)}L).
            </p>

            {isLocked && (
              <div className="bg-amber-500/10 border border-amber-500/15 text-amber-400 text-xs px-4 py-3 rounded-xl flex items-start gap-2">
                <Clock className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" />
                <div>
                  <span className="font-bold block text-amber-300">🔒 After-Hours Dispatch Mode</span>
                  Only dispatches for <strong className="text-white">Vehicle Breakdown</strong> or <strong className="text-white">Active Night Work</strong> are permitted at this time.
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/10 text-red-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Site fuel dispatch recorded and balance updated successfully!</span>
              </div>
            )}

            <form onSubmit={handleSiteIssueSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Select Target Project Site
                </label>
                <select
                  name="projectId"
                  required
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                >
                  <option value="">-- Choose Project Site --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dispatch Date */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Dispatch Date (defaults to today)
                </label>
                <input
                  type="date"
                  name="issueDate"
                  required
                  defaultValue={todayStr}
                  min={minDateStr}
                  max={todayStr}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                />
              </div>

              {/* Litres */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Litres to Dispatch
                </label>
                <input
                  type="number"
                  name="litres"
                  required
                  step="any"
                  placeholder="e.g. 500"
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                />
              </div>

              {/* Reason */}
              <div>
                {isLocked ? (
                  <>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Reason for After-Hours Dispatch <span className="text-red-400 font-bold">*</span>
                    </label>
                    <select
                      name="reason"
                      required
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                    >
                      <option value="Vehicle Breakdown">Vehicle Breakdown</option>
                      <option value="Active Night Work">Active Night Work</option>
                    </select>
                  </>
                ) : (
                  <>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Transport Reference / Driver (Optional)
                    </label>
                    <input
                      type="text"
                      name="reason"
                      placeholder="e.g. Bowser reg LP-4824 / Driver Sunil"
                      className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                    />
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Site Dispatch
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
