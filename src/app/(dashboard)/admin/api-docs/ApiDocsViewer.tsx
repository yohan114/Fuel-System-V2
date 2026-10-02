"use client";

import React, { useState } from "react";
import { Copy, Check, Search, Terminal, ExternalLink, Code } from "lucide-react";

interface Endpoint {
  path: string;
  method: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
}

export function ApiDocsViewer({ spec }: { spec: any }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTag, setSelectedTag] = useState("ALL");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const pathsObj = spec?.paths || {};
  const endpoints: Endpoint[] = [];

  Object.entries(pathsObj).forEach(([path, methods]: [string, any]) => {
    Object.entries(methods).forEach(([method, def]: [string, any]) => {
      endpoints.push({
        path,
        method: method.toUpperCase(),
        summary: def.summary || def.description || `${method.toUpperCase()} ${path}`,
        description: def.description,
        tags: def.tags || ["General"],
        parameters: def.parameters || [],
      });
    });
  });

  const tags = ["ALL", ...Array.from(new Set(endpoints.flatMap((e) => e.tags || [])))];

  const filtered = endpoints.filter((e) => {
    const matchesSearch =
      e.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.summary.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTag = selectedTag === "ALL" || e.tags?.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const copyCurl = (method: string, path: string) => {
    const cmd = `curl -X ${method} "http://localhost:3000${path}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Accept: application/json"`;
    navigator.clipboard.writeText(cmd);
    setCopiedPath(`${method}-${path}`);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const methodColor = (m: string) => {
    switch (m) {
      case "GET":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "POST":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "PATCH":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "DELETE":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Tag Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#121420] border border-white/5 rounded-2xl p-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search API endpoints or descriptions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1b1e30] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] text-gray-400 font-medium">Tag:</span>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTag(t)}
              className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                selectedTag === t
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-3">
        {filtered.map((ep) => {
          const key = `${ep.method}-${ep.path}`;
          const isCopied = copiedPath === key;
          return (
            <div
              key={key}
              className="bg-[#121420] border border-white/5 rounded-2xl p-4 hover:border-white/10 transition-all space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wide border ${methodColor(
                      ep.method
                    )}`}
                  >
                    {ep.method}
                  </span>
                  <code className="text-white font-mono text-xs font-semibold">{ep.path}</code>
                  {ep.tags?.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded text-[10px] bg-white/5 border border-white/5 text-gray-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => copyCurl(ep.method, ep.path)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition-all self-start sm:self-auto"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied cURL</span>
                    </>
                  ) : (
                    <>
                      <Terminal className="w-3.5 h-3.5 text-gray-400" />
                      <span>Copy cURL</span>
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-400">{ep.summary}</p>

              {ep.parameters && ep.parameters.length > 0 && (
                <div className="pt-2 border-t border-white/5 flex gap-2 flex-wrap items-center">
                  <span className="text-[10px] uppercase font-bold text-gray-500">Params:</span>
                  {ep.parameters.map((p) => (
                    <span
                      key={p.name}
                      className="text-[11px] font-mono px-2 py-0.5 rounded bg-black/40 border border-white/5 text-gray-300"
                    >
                      {p.name} {p.required && <span className="text-rose-400">*</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
