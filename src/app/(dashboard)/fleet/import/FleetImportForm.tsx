"use client";

import React, { useState } from "react";
import { bulkImportAssetsAction } from "@/app/actions/fleet";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import Link from "next/link";

interface ParsedRow {
  code: string;
  brand?: string;
  model?: string;
  regNo?: string;
  categoryCode?: string;
  meterType?: string;
  site?: string;
  dailyCapLitres?: number;
  billFuelOnly?: boolean;
}

export function FleetImportForm() {
  const [csvText, setCsvText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "ok" | "err";
    message: string;
    created?: number;
    updated?: number;
  } | null>(null);

  const sampleCsv = `code,brand,model,regNo,categoryCode,meterType,site,dailyCapLitres,billFuelOnly
HEX-88,CAT,320D,WP-CAT-0088,EXCAVATOR,HOURS,Kotugoda,250,false
DT-99,ISUZU,GIGA,WP-LH-9900,DUMP_TRUCK,KM,Badalgama,180,false
PV-42,TOYOTA,HILUX,WP-CAB-4200,OTHER,KM,Colombo Office,60,true`;

  const parseCsv = (text: string) => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const rows: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
      const rowObj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] || "";
      });

      if (rowObj.code) {
        rows.push({
          code: rowObj.code,
          brand: rowObj.brand || undefined,
          model: rowObj.model || undefined,
          regNo: rowObj.regNo || undefined,
          categoryCode: rowObj.categoryCode || undefined,
          meterType: rowObj.meterType || "KM",
          site: rowObj.site || undefined,
          dailyCapLitres: rowObj.dailyCapLitres ? parseFloat(rowObj.dailyCapLitres) : undefined,
          billFuelOnly: rowObj.billFuelOnly === "true",
        });
      }
    }
    return rows;
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setCsvText(text);
    setParsedRows(parseCsv(text));
    setResult(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content);
      setParsedRows(parseCsv(content));
      setResult(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await bulkImportAssetsAction(parsedRows);
      if (res.error) {
        setResult({ type: "err", message: res.error });
      } else {
        setResult({
          type: "ok",
          message: res.message || "Bulk import succeeded!",
          created: res.createdCount,
          updated: res.updatedCount,
        });
        setParsedRows([]);
        setCsvText("");
      }
    } catch {
      setResult({ type: "err", message: "Import request failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {result && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-xs border ${
            result.type === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {result.type === "ok" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
          {result.type === "ok" && (
            <Link
              href="/fleet"
              className="inline-flex items-center gap-1 font-semibold text-emerald-300 hover:text-white"
            >
              View Fleet Directory <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      )}

      {/* Input Form Card */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              Paste CSV or Select File
            </h3>
            <p className="text-[11px] text-gray-400">
              Headers: <code className="text-gray-300 font-mono">code, brand, model, regNo, categoryCode, meterType, site, dailyCapLitres, billFuelOnly</code>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCsvText(sampleCsv);
                setParsedRows(parseCsv(sampleCsv));
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 transition-all"
            >
              Load Sample Data
            </button>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 text-xs font-semibold border border-indigo-500/20 transition-all">
              <Upload className="w-3.5 h-3.5" /> Choose CSV
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>

        <textarea
          rows={7}
          value={csvText}
          onChange={handleTextChange}
          placeholder="Paste comma-separated machine rows here..."
          className="w-full bg-[#1b1e30] border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Preview Table */}
      {parsedRows.length > 0 && (
        <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                Preview ({parsedRows.length} machines ready to import)
              </h3>
              <p className="text-[11px] text-gray-400">
                Existing machines will be updated in-place; new machines will be registered.
              </p>
            </div>

            <button
              type="button"
              onClick={handleImport}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Confirm & Import {parsedRows.length} Vehicles
            </button>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider text-[10px] sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Code</th>
                  <th className="px-4 py-2.5 font-semibold">Brand / Model</th>
                  <th className="px-4 py-2.5 font-semibold">Registration #</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 font-semibold">Meter</th>
                  <th className="px-4 py-2.5 font-semibold">Site</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Daily Cap</th>
                  <th className="px-4 py-2.5 font-semibold">Fuel Only</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {parsedRows.map((r, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2 font-bold text-white font-mono">{r.code}</td>
                    <td className="px-4 py-2 text-gray-300">
                      {r.brand || "—"} {r.model || ""}
                    </td>
                    <td className="px-4 py-2 text-gray-300 font-mono">{r.regNo || "—"}</td>
                    <td className="px-4 py-2 text-indigo-400">{r.categoryCode || "OTHER"}</td>
                    <td className="px-4 py-2 text-gray-400">{r.meterType}</td>
                    <td className="px-4 py-2 text-gray-300">{r.site || "—"}</td>
                    <td className="px-4 py-2 text-right text-gray-300">
                      {r.dailyCapLitres ? `${r.dailyCapLitres} L` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {r.billFuelOnly ? (
                        <span className="text-[10px] text-amber-400 font-bold">YES</span>
                      ) : (
                        <span className="text-[10px] text-gray-600">NO</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
