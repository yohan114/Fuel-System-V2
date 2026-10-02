"use client";

import React, { useState } from "react";
import { Key, Plus, Copy, Check, ShieldAlert, Trash2, CheckCircle2, Clock } from "lucide-react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/api-keys";

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  active: boolean;
  createdAt: Date | string;
  revokedAt: Date | string | null;
  lastUsedAt: Date | string | null;
  createdBy: {
    id: string;
    name: string;
    username: string;
  } | null;
}

const AVAILABLE_SCOPES = [
  { id: "*", label: "Full System Access (*)", desc: "All read and write operations" },
  { id: "read:fleet", label: "Read Fleet", desc: "View vehicle roster & specifications" },
  { id: "write:fuel", label: "Issue Fuel", desc: "Dispense fuel & create issue records" },
  { id: "read:fuel", label: "Read Fuel", desc: "View dispatches & pump history" },
  { id: "write:requests", label: "Fuel Requests", desc: "Create vehicle fuel requests" },
  { id: "write:readings", label: "Submit Readings", desc: "Record odometer / hour meter logs" },
  { id: "read:readings", label: "Read Readings", desc: "Inspect meter logs" },
  { id: "write:conditions", label: "Log Conditions", desc: "Log daily WORKING / BREAKDOWN status" },
  { id: "read:billing", label: "Read Invoices", desc: "Access billing statements & rates" },
  { id: "write:services", label: "Log Services", desc: "Record service maintenance" },
];

export default function ApiKeyClient({ initialKeys }: { initialKeys: ApiKeyItem[] }) {
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["*"]);
  const [isLoading, setIsLoading] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleScope = (scopeId: string) => {
    if (scopeId === "*") {
      setSelectedScopes(["*"]);
      return;
    }
    const withoutAll = selectedScopes.filter((s) => s !== "*");
    if (withoutAll.includes(scopeId)) {
      const next = withoutAll.filter((s) => s !== scopeId);
      setSelectedScopes(next.length === 0 ? ["*"] : next);
    } else {
      setSelectedScopes([...withoutAll, scopeId]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const scopesStr = selectedScopes.join(",");
      const res = await createApiKeyAction(name, scopesStr);
      if (res.error) {
        setError(res.error);
      } else if (res.apiKey) {
        setCreatedKey(res.apiKey);
        setName("");
        // Reload list
        setKeys((prev) => [
          {
            id: res.keyId!,
            name: res.name!,
            keyPrefix: res.keyPrefix!,
            scopes: scopesStr,
            active: true,
            createdAt: new Date().toISOString(),
            revokedAt: null,
            lastUsedAt: null,
            createdBy: null,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      setError("An unexpected error occurred while creating key.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (id: string, keyName: string) => {
    if (!confirm(`Are you sure you want to revoke API key '${keyName}'? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await revokeApiKeyAction(id);
      if (res.error) {
        alert(res.error);
      } else {
        setKeys((prev) =>
          prev.map((k) => (k.id === id ? { ...k, active: false, revokedAt: new Date().toISOString() } : k))
        );
      }
    } catch {
      alert("Failed to revoke key.");
    }
  };

  const copyToClipboard = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="space-y-8">
      {/* Banner when a new key is generated */}
      {createdKey && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-white space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>API Key Created Successfully</span>
          </div>
          <p className="text-xs text-gray-300">
            Please copy this API key now. For security reasons, <strong>it will never be shown again</strong>.
          </p>
          <div className="flex items-center gap-2 bg-[#0d0e15] border border-white/10 rounded-xl p-3">
            <code className="text-xs font-mono text-emerald-300 select-all flex-1 break-all">
              {createdKey}
            </code>
            <button
              onClick={copyToClipboard}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-[11px] text-gray-400 hover:text-white underline mt-2"
          >
            I have saved this key safely
          </button>
        </div>
      )}

      {/* Create New Key Section */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-400" />
          Generate New API Key
        </h3>

        <form onSubmit={handleCreate} className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl p-3 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Key Name / Integration Label
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Workshop Mobile Tablets / ERP Sync Gateway"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Permissions & Scopes
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {AVAILABLE_SCOPES.map((scope) => {
                const isChecked = selectedScopes.includes(scope.id);
                return (
                  <button
                    type="button"
                    key={scope.id}
                    onClick={() => toggleScope(scope.id)}
                    className={`flex flex-col text-left p-2.5 rounded-xl border text-xs transition-all ${
                      isChecked
                        ? "bg-indigo-600/15 border-indigo-500/40 text-white"
                        : "bg-[#1b1e30]/60 border-white/5 text-gray-400 hover:border-white/10"
                    }`}
                  >
                    <span className="font-semibold text-[11px] flex items-center justify-between">
                      {scope.label}
                      {isChecked && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-0.5">{scope.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <Key className="w-4 h-4" />
              {isLoading ? "Generating..." : "Generate API Key"}
            </button>
          </div>
        </form>
      </div>

      {/* Existing Keys Table */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400" />
          Active & Revoked API Keys ({keys.length})
        </h3>

        {keys.length === 0 ? (
          <div className="bg-white/5 border border-white/5 rounded-2xl py-12 text-center text-xs text-gray-500">
            No API keys issued yet. Create one above for external integrations or mobile clients.
          </div>
        ) : (
          <div className="bg-white/5 border border-white/5 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-gray-400 bg-white/[0.02]">
                    <th className="py-3 px-4 font-semibold">Name</th>
                    <th className="py-3 px-4 font-semibold">Prefix</th>
                    <th className="py-3 px-4 font-semibold">Scopes</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">Last Used</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {keys.map((k) => (
                    <tr key={k.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 font-medium text-white">
                        {k.name}
                        {k.createdBy && (
                          <span className="block text-[10px] text-gray-500">
                            By {k.createdBy.name}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-300">
                        {k.keyPrefix}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-[10px] bg-white/5 border border-white/10 px-2 py-0.5 rounded-md text-gray-300">
                          {k.scopes}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {k.active ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 bg-gray-500/10 px-2 py-0.5 rounded-full">
                            Revoked
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-[11px]">
                        {k.lastUsedAt ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-500" />
                            {new Date(k.lastUsedAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-gray-600">Never</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {k.active ? (
                          <button
                            onClick={() => handleRevoke(k.id, k.name)}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            title="Revoke Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-600">—</span>
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
    </div>
  );
}
