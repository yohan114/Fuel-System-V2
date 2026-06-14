import React from "react";
import { runOnDemandBackupAction } from "@/app/actions/admin";
import fs from "fs";
import path from "path";
import { Database, Plus, Download, ShieldAlert, CheckCircle2 } from "lucide-react";

export default async function AdminBackupsPage() {
  // 1. Read files from the backups directory
  const backupDir = path.join(process.cwd(), "backups");
  let backups: { name: string; size: number; mtime: Date }[] = [];

  if (fs.existsSync(backupDir)) {
    const files = fs.readdirSync(backupDir);
    backups = files
      .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
      .map((f) => {
        const fullPath = path.join(backupDir, f);
        const stat = fs.statSync(fullPath);
        return {
          name: f,
          size: stat.size,
          mtime: stat.mtime,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // Newest first
  }

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Run Backup control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/5 border border-white/5 p-5 rounded-2xl">
        <div>
          <h3 className="text-sm font-bold text-white tracking-wide uppercase">On-Demand Backup</h3>
          <p className="text-[11px] text-gray-400 mt-1 max-w-md">
            Clicking the button runs an atomic SQLite hot backup (`VACUUM INTO`), generating a download-ready timestamped file.
          </p>
        </div>
        <form action={async () => {
          "use server";
          await runOnDemandBackupAction();
        }}>
          <button
            type="submit"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide shadow-md active:scale-95 transition-all w-fit"
          >
            <Plus className="w-4 h-4" />
            Trigger Backup Now
          </button>
        </form>
      </div>

      {/* Backup file logs list */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-400" />
          Backup Archives Directory ({backups.length})
        </h3>

        {backups.length === 0 ? (
          <div className="bg-white/5 border border-white/5 rounded-2xl py-12 text-center text-xs text-gray-500">
            No database backup files found in the archive directory.
          </div>
        ) : (
          <div className="border border-white/5 rounded-2xl overflow-hidden shadow-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
                  <th className="px-6 py-3">Filename</th>
                  <th className="px-6 py-3">Creation Date</th>
                  <th className="px-6 py-3">Size</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {backups.map((b) => (
                  <tr key={b.name} className="hover:bg-white/[0.01]">
                    <td className="px-6 py-3.5 text-white font-mono font-medium">
                      {b.name}
                    </td>
                    <td className="px-6 py-3.5 text-gray-300">
                      {new Date(b.mtime).toLocaleString("en-US", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="px-6 py-3.5 text-gray-400 font-semibold">
                      {formatSize(b.size)}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <a
                        href={`/api/admin/backup/download?file=${b.name}`}
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-bold hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
