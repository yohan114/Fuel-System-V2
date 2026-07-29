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
  // Litre figures are ADMIN-only and arrive as null for every other role, so a
  // pump operator cannot read the tank level and size a fake issue to cover a
  // physical shortfall. See src/lib/tank-visibility.ts.
  balance: number | null;
  capacity: number | null;
  hasStock: boolean;
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
    regNo: string | null;
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
  title?: string;
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
  minDateStr,
  title = "Workshop Pump Console"
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

  // Replenishment source: an outside supplier purchase, or a transfer from
  // another site that has fuel available.
  const [reqSource, setReqSource] = useState<"OUTSIDE" | "SITE">("OUTSIDE");
  const [reqSourceTankId, setReqSourceTankId] = useState<string>("");

  // Holds a replenishment the operator has filled in but not yet confirmed.
  // Non-null means the confirmation panel is showing instead of the form.
  const [pendingReplenish, setPendingReplenish] = useState<{
    formData: FormData;
    litres: number;
    sourceLabel: string;
  } | null>(null);



  const openModal = (type: "replenish" | "issue" | "site-issue") => {
    setActiveModal(type);
    setError(null);
    setSuccess(false);
    setSelectedAssetCode("");
    setSelectedProjectId("");
    setPendingReplenish(null);
  };

  const closeModal = () => {
    setActiveModal(null);
    setPendingReplenish(null);
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

          // Decrement local balance in UI state (admins only — other roles are
          // never sent a balance to decrement)
          setActiveTank(prev =>
            prev && prev.balance !== null ? { ...prev, balance: prev.balance - litres } : prev
          );

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
              asset: { code: assetCode, regNo: selectedAsset?.regNo ?? null },
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

    const litres = parseFloat(formData.get("requestedLitres")?.toString() || "0");
    if (!isFinite(litres) || litres <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (reqSource === "SITE" && !formData.get("sourceTankId")?.toString()) {
      setError("Choose the site to draw the fuel from.");
      return;
    }

    // A replenishment is applied to stock the moment it is recorded and there is
    // no edit or delete afterwards, so the operator confirms the exact figures
    // first. The FormData is captured here because e.currentTarget is gone by
    // the time the confirmation is answered.
    setPendingReplenish({
      formData,
      litres,
      sourceLabel:
        reqSource === "SITE"
          ? allTanks.find((t) => t.id === reqSourceTankId)?.name ?? "another site"
          : "Outside purchase (supplier delivery)",
    });
  };

  const confirmReplenish = () => {
    if (!pendingReplenish) return;
    const { formData, litres } = pendingReplenish;
    setError(null);

    startTransition(async () => {
      try {
        const res = await submitBulkRequestAction(formData);
        if (res.error) {
          setError(res.error);
          setPendingReplenish(null);
        } else {
          setSuccess(true);
          setPendingReplenish(null);
          // Mirrors what the server actually wrote: replenishment is applied on
          // record, so this must not claim to be awaiting approval.
          setRequests(prev => [
            {
              id: Math.random().toString(),
              fuelKind: activeTank?.fuelKind || "AUTO_DIESEL",
              requestedLitres: litres,
              status: "APPROVED",
              createdAt: new Date(),
              reviewNote: null,
            },
            ...prev,
          ]);
          setTimeout(() => closeModal(), 1500);
        }
      } catch (err: any) {
        setPendingReplenish(null);
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

          // Decrement local balance in UI state (admins only — other roles are
          // never sent a balance to decrement)
          setActiveTank(prev =>
            prev && prev.balance !== null ? { ...prev, balance: prev.balance - litres } : prev
          );

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
              asset: { code: assetCode, regNo: selectedAsset?.regNo ?? null },
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

  // Non-admin roles receive no litre figures at all, so the stock panel is not
  // rendered for them and there is nothing to plot.
  const showBalance = activeTank.balance !== null && activeTank.capacity !== null;
  const percent = showBalance
    ? Math.min(100, Math.max(0, (activeTank.balance! / activeTank.capacity!) * 100))
    : 0;

  return (
    <div className="space-y-8">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">{title}</h1>
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
            Record Bulk Replenishment
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

        {/* Pump Fuel Inventory Progress card — ADMIN only. Operators are shown
            no stock panel at all, so the tank level cannot be used to size a
            fake issue that covers a physical shortfall. */}
        {showBalance && (
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
              <span className="text-xl font-bold text-white">{activeTank.balance!.toLocaleString(undefined, { maximumFractionDigits: 1 })} L</span>
              <span>Capacity: {activeTank.capacity!.toLocaleString()} L</span>
            </div>
            
            <div className="w-full bg-white/5 h-3.5 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-full rounded-full transition-all duration-500 shadow" 
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] text-gray-500 font-semibold pt-1">
              <span>{percent.toFixed(0)}% full</span>
              <span>Available Space: {(activeTank.capacity! - activeTank.balance!).toLocaleString(undefined, { maximumFractionDigits: 1 })} L</span>
            </div>
          </div>
        </div>
        )}

        {/* Local Fuel Pump Scrap Info */}
        <div className={`${showBalance ? "" : "lg:col-span-3"} bg-[#121420] border border-white/5 p-6 rounded-2xl shadow-xl flex flex-col justify-between`}>
          <div>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Operator Instructions</h4>
            <ul className="text-[11px] text-gray-400 space-y-2 list-disc pl-4 leading-relaxed font-medium">
              <li>You can refuel <strong>any vehicle or machinery</strong> in the E&C fleet.</li>
              <li>Dispatched quantities are automatically deducted from your pump storage.</li>
              <li>Record a bulk replenishment as soon as fuel is delivered — it is applied immediately.</li>
              <li>Type custom asset codes to auto-create unregistered items under "OTHER".</li>
              {!showBalance && (
                <li>
                  Tank stock figures are held by management. Every issue and every
                  replenishment is logged against your name.
                </li>
              )}
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
                      {issue.asset.regNo && (
                        <span className="text-[10px] text-indigo-300 font-semibold">{issue.asset.regNo}</span>
                      )}
                      <span className="text-[10px] text-gray-400 font-semibold">({issue.litres}L)</span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">
                      Issued to {issue.asset.code}{issue.asset.regNo ? ` (${issue.asset.regNo})` : ""} • {new Date(issue.issueDate).toLocaleDateString()}
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
              <div className="py-12 text-center text-xs text-gray-500">No replenishments recorded yet.</div>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="p-3.5 bg-white/5 rounded-xl border border-white/5 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white text-sm">
                      {req.requestedLitres.toLocaleString()} L
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1">
                      Recorded: {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  {/* An APPROVED row means the litres are already in the tank.
                      Labelling it "APPROVED" (or worse, "PENDING") reads as
                      "still waiting", which invites the operator to record the
                      same delivery a second time. */}
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                    req.status === "APPROVED"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : req.status === "REJECTED"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {req.status === "APPROVED" ? "ADDED TO STOCK" : req.status}
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
              Record Bulk Refuel
            </h3>
            <p className="text-xs text-gray-400">
              Record fuel loaded into <strong>{activeTank.name}</strong>. It is applied to
              stock immediately and logged against your name.
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
                <span>Replenishment recorded and stock updated.</span>
              </div>
            )}

            {pendingReplenish ? (
              /* Second step: a replenishment hits stock the instant it is
                 recorded and cannot be edited or deleted, so the operator
                 re-reads the exact figures before it is written. */
              <div className="space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-4 py-3 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-bold block text-amber-200 mb-0.5">Please check carefully</span>
                    This is added to tank stock straight away. It <strong>cannot be
                    edited or deleted</strong> afterwards, and is logged against your name.
                  </div>
                </div>

                <div className="bg-[#1b1e30] border border-white/5 rounded-xl divide-y divide-white/5">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Quantity</span>
                    <span className="text-lg font-bold text-white">{pendingReplenish.litres.toLocaleString()} L</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Fuel</span>
                    <span className="text-xs font-semibold text-gray-200 uppercase">{activeTank.fuelKind.replace("_", " ")}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Into tank</span>
                    <span className="text-xs font-semibold text-gray-200">{activeTank.name}</span>
                  </div>
                  <div className="flex justify-between items-center gap-3 px-4 py-2.5">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0">Source</span>
                    <span className="text-xs font-semibold text-gray-200 text-right">{pendingReplenish.sourceLabel}</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setPendingReplenish(null)}
                    disabled={isPending}
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 text-gray-300 font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                  >
                    Go Back &amp; Edit
                  </button>
                  <button
                    type="button"
                    onClick={confirmReplenish}
                    disabled={isPending}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    Yes, add {pendingReplenish.litres.toLocaleString()} L
                  </button>
                </div>
              </div>
            ) : (
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
                  Fuel Source
                </label>
                <select
                  name="sourceType"
                  value={reqSource}
                  onChange={(e) => { setReqSource(e.target.value as "OUTSIDE" | "SITE"); setReqSourceTankId(""); }}
                  className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                >
                  <option value="OUTSIDE">Outside Purchase (supplier delivery)</option>
                  <option value="SITE">From Another Site (transfer available fuel)</option>
                </select>
              </div>

              {reqSource === "SITE" && (
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Draw Fuel From Site
                  </label>
                  <select
                    name="sourceTankId"
                    required
                    value={reqSourceTankId}
                    onChange={(e) => setReqSourceTankId(e.target.value)}
                    className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
                  >
                    <option value="">Select a site with available fuel…</option>
                    {allTanks
                      .filter((t) => t.id !== activeTank.id && t.fuelKind === activeTank.fuelKind && t.hasStock)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {/* Litres are appended for admins only: listing every
                              site's stock to an operator hands them a map of
                              where fuel is available to draw against. */}
                          {t.name}
                          {t.balance !== null ? ` — ${t.balance.toLocaleString()} L available` : ""}
                        </option>
                      ))}
                  </select>
                  {allTanks.filter((t) => t.id !== activeTank.id && t.fuelKind === activeTank.fuelKind && t.hasStock).length === 0 && (
                    <p className="text-[10px] text-amber-400 mt-1.5">
                      No other site currently has {activeTank.fuelKind.replace("_", " ")} fuel available.
                    </p>
                  )}
                </div>
              )}

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
                Review &amp; Record
              </button>
            </form>
            )}
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
              Draw fuel from the <strong>{activeTank.name}</strong> balance
              {showBalance ? ` (Remaining: ${activeTank.balance!.toFixed(1)}L).` : "."}
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
                      <React.Fragment key={a.id}>
                        <option value={a.code}>
                          {a.code}{a.regNo ? ` • ${a.regNo}` : ""} ({a.meterType})
                        </option>
                        {a.regNo && (
                          <option value={a.regNo}>
                            {a.regNo} • {a.code} ({a.meterType})
                          </option>
                        )}
                      </React.Fragment>
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
              Dispatch bulk fuel to another project site from <strong>{activeTank.name}</strong>
              {showBalance ? ` (Available: ${activeTank.balance!.toFixed(1)}L).` : "."}
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
