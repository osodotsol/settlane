import { CircleHelp, ShieldAlert } from "lucide-react";
import { CopyButton } from "./CopyButton";

// The contract page's centrepiece: does the code on Sepolia equal the open-source build? A ring and a check
// draw in once (CSS only, removed under reduced motion), and the two hashes sit beside the verdict.
type Props = { status: "match" | "mismatch" | "unknown"; pinned: string; live: string | null; bytes: number | null };

export function VerificationSeal({ status, pinned, live, bytes }: Props) {
  const tone = status === "match" ? "text-paid" : status === "mismatch" ? "text-danger" : "text-ink-3";
  return (
    <div className="stage rounded-2xl p-6 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] sm:p-8">
      <div className="flex items-center gap-5">
        <div className={`relative grid size-20 shrink-0 place-items-center ${tone}`} aria-hidden>
          {status === "match" ? (
            <svg viewBox="0 0 80 80" className="size-20" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="40" cy="40" r="34" pathLength="1" className="draw-ring" style={{ "--d": 150 } as React.CSSProperties} transform="rotate(-90 40 40)" />
              <path d="M26 41.5 36 51.5 55 30" pathLength="1" className="draw-ring" style={{ "--d": 900 } as React.CSSProperties} />
            </svg>
          ) : status === "mismatch" ? (
            <ShieldAlert size={56} strokeWidth={1.5} />
          ) : (
            <CircleHelp size={56} strokeWidth={1.5} />
          )}
        </div>
        <div>
          <p className="text-sm text-ink-3">Verification, read from Sepolia just now</p>
          <p className="text-title mt-1">
            {status === "match" ? "Deployed code matches the build" : status === "mismatch" ? "Deployed code does NOT match the build" : "The deployed code could not be read"}
          </p>
          {status === "match" && <p className="mt-1 text-sm text-ink-2">Byte for byte, with the open-source Fe 26.6.0 build.</p>}
        </div>
      </div>

      <dl className="mt-7 space-y-5 border-t border-line pt-6">
        <div>
          <dt className="text-sm text-ink-3">Open-source build, pinned in the repository (runtime SHA-256)</dt>
          <dd className="mt-1.5 flex items-start justify-between gap-2">
            <span className="text-data break-all text-[0.8125rem]">{pinned}</span>
            <CopyButton value={pinned} label="pinned runtime hash" />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-3">
            Deployed code on Sepolia{bytes !== null ? ` (${bytes.toLocaleString("en-US")} bytes)` : ""}
          </dt>
          <dd className="mt-1.5 flex items-start justify-between gap-2">
            {live ? (
              <>
                <span className={`text-data break-all text-[0.8125rem] ${status === "mismatch" ? "text-danger" : ""}`}>{live}</span>
                <CopyButton value={live} label="deployed runtime hash" />
              </>
            ) : (
              <span className="text-ink-2">Unavailable right now.</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
