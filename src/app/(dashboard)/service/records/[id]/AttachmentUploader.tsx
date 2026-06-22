"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadServiceAttachmentsAction } from "@/app/actions/attachment";
import { Upload } from "lucide-react";

const inputCls = "bg-[#121420] border border-white/5 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500/40";

export default function AttachmentUploader({ serviceRecordId }: { serviceRecordId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasFiles, setHasFiles] = useState(false);
  const [caption, setCaption] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const files = inputRef.current?.files;
    if (!files || files.length === 0) return setError("Choose at least one file");

    const fd = new FormData();
    fd.set("serviceRecordId", serviceRecordId);
    fd.set("caption", caption.trim());
    for (const f of Array.from(files)) fd.append("files", f);

    startTransition(async () => {
      const res = await uploadServiceAttachmentsAction(fd);
      if (res?.error) setError(res.error);
      else {
        setCaption("");
        setHasFiles(false);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/5">
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(e) => setHasFiles((e.target.files?.length || 0) > 0)}
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,text/plain"
        className="text-xs text-gray-400 file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white file:text-xs hover:file:bg-white/20"
      />
      <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" className={inputCls} />
      <button
        type="submit"
        disabled={isPending || !hasFiles}
        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg px-4 py-2 flex items-center gap-1.5"
      >
        <Upload className="w-4 h-4" /> {isPending ? "Uploading…" : "Upload"}
      </button>
      <span className="text-[10px] text-gray-500 w-full">Images, PDF, Word, Excel, CSV or text · max 25 MB each.</span>
      {error && <span className="text-[10px] text-red-400 w-full">{error}</span>}
    </form>
  );
}
