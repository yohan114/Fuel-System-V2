import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOpenApiSpec } from "@/lib/api/openapi";
import { FileCode2, ExternalLink } from "lucide-react";
import { ApiDocsViewer } from "./ApiDocsViewer";

export default async function AdminApiDocsPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const spec = getOpenApiSpec();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-indigo-400" /> REST API Documentation & Console
          </h1>
          <p className="text-xs text-gray-400">
            OpenAPI 3.1 specification for Fuel System V2 public API (/api/v1/*). Authenticate requests using an API Key or active session cookie.
          </p>
        </div>

        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 border border-white/10 transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5" /> View Raw openapi.json
        </a>
      </div>

      <ApiDocsViewer spec={spec} />
    </div>
  );
}
