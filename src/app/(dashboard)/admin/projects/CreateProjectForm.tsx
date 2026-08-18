"use client";

import React, { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createProjectAction } from "@/app/actions/project";

// Registering a site that already exists also creates a second tank, which is
// what split Badalgama's fuel history from its balance. The action returns
// `similarProject` in that case; the admin then either uses the existing site
// or confirms this really is a separate place.
export default function CreateProjectForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (_prev: Awaited<ReturnType<typeof createProjectAction>> | null, fd: FormData) =>
      createProjectAction(fd),
    null
  );

  useEffect(() => {
    if (state && "success" in state && state.success) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  const similar = state && "similarProject" in state ? state.similarProject : undefined;
  const error = state && "error" in state ? state.error : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Project Name
        </label>
        <input
          type="text"
          name="name"
          required
          placeholder="e.g. Ruwanwella Water Project"
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Project Code
        </label>
        <input
          type="text"
          name="code"
          required
          placeholder="e.g. RWP"
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50 font-bold tracking-wide"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Billing Contact Name
        </label>
        <input
          type="text"
          name="contactName"
          placeholder="e.g. Site Accounts Officer"
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Billing Contact Email
        </label>
        <input
          type="email"
          name="contactEmail"
          placeholder="invoices@site.example"
          className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      {error && (
        <div className="text-xs rounded-xl px-4 py-3 border bg-amber-500/10 text-amber-200 border-amber-500/25 space-y-3">
          <div className="flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <span>{error}</span>
          </div>
          {similar && (
            <label className="flex items-center gap-2 text-amber-100 cursor-pointer">
              <input type="checkbox" name="allowSimilar" value="true" className="accent-amber-500" />
              <span>
                This is a separate site from &quot;{similar.name}&quot; — register it anyway
              </span>
            </label>
          )}
        </div>
      )}

      {state && "success" in state && state.success && (
        <div className="text-xs rounded-xl px-4 py-3 border bg-emerald-500/10 text-emerald-300 border-emerald-500/10">
          Project registered with its own diesel tank.
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
      >
        {pending ? "Registering…" : "Register Project"}
      </button>
    </form>
  );
}
