import { CircleAlert, FlaskConical, Info } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "info" | "danger" | "simulation";

const tones: Record<Tone, string> = {
  info: "border-line bg-surface text-ink-2",
  danger: "border-danger bg-danger-tint text-ink",
  // Distinct striped edge: simulated state must never look like chain data (DESIGN.md §4).
  simulation:
    "border-submitted bg-surface text-ink [border-left-width:8px] [border-image:repeating-linear-gradient(135deg,var(--state-submitted)_0_6px,transparent_6px_12px)_8]",
};

const icons = { info: Info, danger: CircleAlert, simulation: FlaskConical };

export function Banner({ tone = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  const Icon = icons[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`flex gap-3 rounded-lg border px-4 py-3 ${tones[tone]}`}>
      <Icon aria-hidden size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5">{children}</div>}
      </div>
    </div>
  );
}
