import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { batteryList, batteryHistory } from "@/lib/stock/queries";
import { BatteryCharging, ScrollText } from "lucide-react";
import BatteryForm from "./BatteryForm";
import BatteryActions from "./BatteryActions";

const ACTION_STYLE: Record<string, string> = {
  ADD: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  TRANSFER: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  DECOMMISSION: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  EDIT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default async function BatteriesPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "STOREKEEPER") redirect("/");

  const [batteries, history] = await Promise.all([batteryList(), batteryHistory(80)]);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <BatteryCharging className="w-5 h-5 text-indigo-400" /> Battery Register
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          One live battery per vehicle (vehicle &amp; serial both unique), each with a mandatory photo. Batteries are never deleted — transfer and decommission are recorded in an append-only history.
        </p>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white mb-4">Register a battery</h2>
        <BatteryForm />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Live batteries ({batteries.length})</h2>
        {batteries.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No batteries registered yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Photo</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">Serial</th>
                <th className="py-2.5">Note</th>
                <th className="py-2.5">Added</th>
                <th className="py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {batteries.map((b) => (
                <tr key={b.id} className="hover:bg-white/[0.01]">
                  <td className="py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/batteries/${b.id}/photo`} alt={b.serialNo} className="w-12 h-12 object-cover rounded-lg border border-white/10" />
                  </td>
                  <td className="py-3 font-bold text-white font-mono">{b.vehicleNo}</td>
                  <td className="py-3 text-gray-300 font-mono">{b.serialNo}</td>
                  <td className="py-3 text-gray-500">{b.note ?? "—"}</td>
                  <td className="py-3 text-gray-400 whitespace-nowrap">{b.createdAt.toLocaleDateString("en-GB")}</td>
                  <td className="py-3"><BatteryActions id={b.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <ScrollText className="w-4 h-4 text-indigo-400" /> History
        </h2>
        {history.length === 0 ? (
          <div className="text-center py-10 text-xs text-gray-500">No battery events yet.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Date</th>
                <th className="py-2.5">Action</th>
                <th className="py-2.5">Serial</th>
                <th className="py-2.5">Vehicle</th>
                <th className="py-2.5">By</th>
                <th className="py-2.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((e) => (
                <tr key={e.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 text-gray-400 whitespace-nowrap">{e.createdAt.toLocaleDateString("en-GB")}</td>
                  <td className="py-3"><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 border ${ACTION_STYLE[e.action] ?? ACTION_STYLE.EDIT}`}>{e.action}</span></td>
                  <td className="py-3 text-gray-300 font-mono">{e.serialNo ?? "—"}</td>
                  <td className="py-3 text-gray-300 font-mono">{e.fromVehicleNo ? `${e.fromVehicleNo} → ${e.vehicleNo}` : e.vehicleNo ?? "—"}</td>
                  <td className="py-3 text-gray-400">{e.actorName ?? "—"}</td>
                  <td className="py-3 text-gray-500">{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
