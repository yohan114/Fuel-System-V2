import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createAssetAction } from "@/app/actions/fleet";
import Link from "next/link";
import { ArrowLeft, PlusCircle, Gauge, Calendar, MapPin, Tag } from "lucide-react";

export default async function NewAssetPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return null;

  // Fetch categories for the select dropdown
  const categories = await prisma.category.findMany({
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <div>
        <Link
          href="/fleet"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Directory
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">Register Fleet Asset</h1>
        <p className="text-xs text-gray-400 mt-1">
          Add a new machine, vehicle, bowser, or motorcycle to the Edward & Christie database registry.
        </p>
      </div>

      {/* Registration Form */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 md:p-8 shadow-xl">
        <form action={async (formData) => {
          "use server";
          await createAssetAction(formData);
        }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Asset Code (E&C Number) */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Asset Code (E&C No)*
              </label>
              <input
                type="text"
                name="code"
                required
                placeholder="e.g. DT-123 or HEX-456"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-bold tracking-wide"
              />
            </div>

            {/* Category selection */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Asset Category*
              </label>
              <select
                name="categoryId"
                required
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.code} - {cat.name} ({cat.defaultMeterType})
                  </option>
                ))}
              </select>
            </div>

            {/* Brand */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Brand
              </label>
              <input
                type="text"
                name="brand"
                placeholder="e.g. TATA or JCB"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Model Number
              </label>
              <input
                type="text"
                name="model"
                placeholder="e.g. LPK 1615 or 3DX"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Type/Label */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Type Description
              </label>
              <input
                type="text"
                name="typeLabel"
                placeholder="e.g. Dump Truck or Excavator"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Registration No */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Registration plate No.
              </label>
              <input
                type="text"
                name="regNo"
                placeholder="e.g. LI-7618"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none font-mono"
              />
            </div>

            {/* Capacity */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Capacity details
              </label>
              <input
                type="text"
                name="capacity"
                placeholder="e.g. 03 Cube or 2523cc"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* YOM */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Manufacture Year (YOM)
              </label>
              <input
                type="number"
                name="yom"
                placeholder="e.g. 2018"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Serial No */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Serial Number
              </label>
              <input
                type="text"
                name="serialNo"
                placeholder="e.g. S/N or frame number"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Chassis No */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Chassis Number
              </label>
              <input
                type="text"
                name="chassisNo"
                placeholder="Enter Chassis No"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Engine No */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Engine Number
              </label>
              <input
                type="text"
                name="engineNo"
                placeholder="Enter Engine No"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Site */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Assigned Site Location
              </label>
              <input
                type="text"
                name="site"
                placeholder="e.g. BADALGAMA"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Metering Unit */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Default Metering Unit
              </label>
              <select
                name="meterType"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              >
                <option value="KM">Kilometres (KM)</option>
                <option value="HOURS">Hours (HOURS)</option>
              </select>
            </div>

            {/* Daily Fuel Cap */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Daily Fuel Cap (Litres)
              </label>
              <input
                type="number"
                name="dailyCapLitres"
                min="1"
                step="1"
                placeholder="Leave blank for no limit"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 border-t border-white/5 pt-6 mt-6">
            <Link
              href="/fleet"
              className="px-5 py-3 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold tracking-wide active:scale-95 transition-all"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold tracking-wide shadow-md hover:shadow-indigo-500/10 active:scale-95 transition-all"
            >
              Register Asset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
