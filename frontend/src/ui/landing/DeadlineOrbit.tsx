// An illustrated deadline ring for the landing page (DESIGN.md §15). It shows the order of the windows for a
// milestone that was submitted: delivery until deliver_by, a decision due by decide_by, then a refund the
// client may take if nothing was decided. The sweeping hand is decoration: the contract judges every window
// by the block's timestamp, and the caption says so. Static under reduced motion.

const C = 170;
const R = 128;

function polar(deg: number, r = R): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(from: number, to: number, r = R) {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const DELIVER = 160; // deliver_by on the ring
const DECIDE = 262; // decide_by on the ring

export function DeadlineOrbit() {
  const marks: [number, string, string][] = [
    [0, "created", "var(--ink-2)"],
    [DELIVER, "deliver_by", "var(--state-funded)"],
    [DECIDE, "decide_by", "var(--state-submitted)"],
  ];
  return (
    <figure className="m-0">
      <div className="relative mx-auto aspect-square w-full max-w-[26rem]">
        <div aria-hidden className="orbit-glow absolute inset-[12%] rounded-full" />
        <svg viewBox="-50 -10 440 360" className="relative size-full" aria-hidden focusable="false">
          <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth="14" />
          <path d={arc(2, DELIVER - 2)} fill="none" stroke="var(--state-funded)" strokeWidth="14" strokeLinecap="round" />
          <path d={arc(DELIVER + 2, DECIDE - 2)} fill="none" stroke="var(--state-submitted)" strokeWidth="14" strokeLinecap="round" />
          <path d={arc(DECIDE + 2, 356)} fill="none" stroke="var(--state-refunded)" strokeWidth="14" strokeDasharray="4 6" strokeOpacity="0.85" />
          <circle cx={C} cy={C} r={R - 26} fill="none" stroke="var(--line)" strokeDasharray="1 6" />
          {marks.map(([deg, label, color]) => {
            const [x, y] = polar(deg);
            const [lx, ly] = polar(deg, R + 30);
            return (
              <g key={label}>
                <circle cx={x} cy={y} r="7" fill="var(--paper)" stroke={color} strokeWidth="3" />
                <text x={lx} y={ly + 4} textAnchor="middle" fill="var(--ink-2)" fontSize="11.5" fontFamily="var(--font-mono)">{label}</text>
              </g>
            );
          })}
          {/* the sweeping block-time hand (illustrative) */}
          <g className="orbit-hand">
            {/* an invisible ring centres the group's box on the clock, so it rotates about the centre */}
            <circle cx={C} cy={C} r={R + 17} fill="none" />
            <line x1={C} y1={C} x2={C} y2={C - R + 18} stroke="url(#orbit-hand)" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={C} cy={C - R} r="9" fill="#ab98ff" />
            <circle cx={C} cy={C - R} r="17" fill="#ab98ff" fillOpacity="0.18" />
          </g>
          <defs>
            <linearGradient id="orbit-hand" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ab98ff" stopOpacity="0" />
              <stop offset="1" stopColor="#ab98ff" />
            </linearGradient>
          </defs>
          <circle cx={C} cy={C} r="54" fill="var(--surface)" stroke="var(--line)" />
          <text x={C} y={C - 6} textAnchor="middle" fill="var(--ink)" fontSize="14" fontWeight="600">block time</text>
          <text x={C} y={C + 14} textAnchor="middle" fill="var(--ink-3)" fontSize="10.5" fontFamily="var(--font-mono)">ctx.timestamp()</text>
        </svg>
      </div>
      <figcaption className="mt-4 text-center text-micro text-ink-3">
        Illustration, not a live clock. The contract compares each deadline with the timestamp of the block that runs the call.
      </figcaption>
    </figure>
  );
}
