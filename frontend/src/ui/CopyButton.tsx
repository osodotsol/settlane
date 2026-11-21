"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* clipboard unavailable: the full value stays selectable in the accessible name */
          }
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}
