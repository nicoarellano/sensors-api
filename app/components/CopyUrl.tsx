"use client";

import { useState } from "react";

/** A read-only, copyable absolute URL — what you paste into a CollabDT sensor. */
export function CopyUrl({ path, label }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // Client-only origin; SSR renders the bare path, so suppress the value mismatch.
  const url = (typeof window === "undefined" ? "" : window.location.origin) + path;
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        suppressHydrationWarning
        aria-label={label ?? "Data URL"}
        value={url}
        className="flex-1 min-w-0 font-mono text-xs bg-black/[.04] dark:bg-white/[.06] rounded px-2 py-1"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="text-xs rounded border border-black/15 dark:border-white/20 px-2 py-1 hover:bg-black/[.04] dark:hover:bg-white/[.06] shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
