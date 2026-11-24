"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The hero's decorative background: metallic ETH coins travelling along luminous violet ribbons, with a brief
 * "Built with Fe" mark riding the main ribbon. Pure SVG (no image asset, no library):
 * - the server and the first client render are the static composition (coins parked along the ribbons);
 * - motion (SMIL) is added only on the client when the viewer has not asked for reduced motion and the
 *   device does not look low-powered, and it is paused while the hero is off screen;
 * - no filters are animated: the glow is layered strokes and gradients, so a frame repaints cheaply.
 * It is aria-hidden; the hero text says everything the picture does.
 */

type Pt = readonly [number, number];
type Ribbon = { id: string; p: readonly [Pt, Pt, Pt, Pt]; width: number; tone: number };

// Three cubic ribbons sweeping up and to the right, in a 1440×800 view box.
const RIBBONS: Ribbon[] = [
  { id: "back", p: [[-120, 800], [360, 810], [860, 450], [1560, 390]], width: 0.55, tone: 0.45 },
  { id: "main", p: [[-120, 700], [420, 720], [760, 300], [1560, 220]], width: 1, tone: 1 },
  { id: "high", p: [[-120, 600], [470, 630], [820, 190], [1560, 100]], width: 0.75, tone: 0.7 },
];

const d = (r: Ribbon) => `M ${r.p[0].join(" ")} C ${r.p[1].join(" ")}, ${r.p[2].join(" ")}, ${r.p[3].join(" ")}`;

/** A point on a cubic Bézier at parameter t (used to park the coins in the static composition). */
export function cubicPoint([p0, p1, p2, p3]: readonly [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]];
}

// Coins per ribbon: travel time, phase (fraction of the trip already done at t=0) and size. Static positions
// reuse the phase as the Bézier parameter, so the still frame matches a moment of the moving one.
const COINS: { ribbon: string; dur: number; phase: number; scale: number; opacity: number }[] = [
  { ribbon: "main", dur: 15, phase: 0.06, scale: 1, opacity: 1 },
  { ribbon: "main", dur: 15, phase: 0.46, scale: 1.08, opacity: 1 },
  { ribbon: "main", dur: 15, phase: 0.86, scale: 0.95, opacity: 1 },
  { ribbon: "high", dur: 19, phase: 0.56, scale: 0.7, opacity: 0.8 },
  { ribbon: "high", dur: 19, phase: 0.78, scale: 0.66, opacity: 0.8 },
  { ribbon: "back", dur: 24, phase: 0.62, scale: 0.5, opacity: 0.55 },
  { ribbon: "back", dur: 24, phase: 0.92, scale: 0.48, opacity: 0.55 },
];

const SPARKS: [number, number, number][] = [
  [980, 250, 0], [1150, 330, 1.4], [700, 420, 2.6], [1290, 160, 3.3], [860, 560, 4.1], [1220, 460, 5.2], [560, 610, 6.0],
];

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribe(notify: () => void) {
  const mq = window.matchMedia(reducedQuery);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
}
function canAnimate() {
  if (window.matchMedia(reducedQuery).matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 1) return false;
  return true;
}

function Coin() {
  return (
    <g>
      <circle r="62" fill="url(#ef-halo)" />
      <circle r="31" fill="url(#ef-metal)" />
      <circle r="31" fill="none" stroke="#e4ddff" strokeOpacity="0.75" strokeWidth="1.6" />
      <circle r="25.5" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1" />
      <polygon points="0,-17 -10.5,1 0,6.6" fill="#ffffff" />
      <polygon points="0,-17 10.5,1 0,6.6" fill="#cfc6ff" />
      <polygon points="0,9.4 -10.5,3 0,17" fill="#f1edff" />
      <polygon points="0,9.4 10.5,3 0,17" fill="#b8adff" />
      <ellipse cx="-10" cy="-14" rx="13" ry="6" fill="#ffffff" fillOpacity="0.28" transform="rotate(-30 -10 -14)" />
    </g>
  );
}

export function EthFlow({ className = "" }: { className?: string }) {
  const motion = useSyncExternalStore(subscribe, canAnimate, () => false);
  const ref = useRef<SVGSVGElement>(null);

  // Pause every animation while the hero is scrolled away (and resume when it returns).
  useEffect(() => {
    const svg = ref.current;
    if (!motion || !svg || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) svg.unpauseAnimations();
      else svg.pauseAnimations();
    });
    io.observe(svg);
    return () => io.disconnect();
  }, [motion]);

  return (
    <svg
      ref={ref}
      aria-hidden
      focusable="false"
      data-eth-flow={motion ? "moving" : "still"}
      viewBox="0 0 1440 800"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none select-none ${className}`}
    >
      <defs>
        <linearGradient id="ef-ribbon" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3b2a9e" stopOpacity="0" />
          <stop offset="0.35" stopColor="#6d4aff" />
          <stop offset="0.7" stopColor="#a78bff" />
          <stop offset="1" stopColor="#5f7dff" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="ef-core" x1="0" x2="1">
          <stop offset="0" stopColor="#c9b8ff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#efe8ff" />
          <stop offset="1" stopColor="#9fb2ff" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="ef-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2efff" />
          <stop offset="0.38" stopColor="#a49be0" />
          <stop offset="0.62" stopColor="#433b86" />
          <stop offset="1" stopColor="#c4baff" />
        </linearGradient>
        <radialGradient id="ef-halo">
          <stop offset="0" stopColor="#8f72ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8f72ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ef-bloom" cx="0.68" cy="0.48" r="0.5">
          <stop offset="0" stopColor="#5a3df0" stopOpacity="0.38" />
          <stop offset="0.55" stopColor="#2b1f7a" stopOpacity="0.16" />
          <stop offset="1" stopColor="#070912" stopOpacity="0" />
        </radialGradient>
        {RIBBONS.map((r) => (
          <path key={r.id} id={`ef-path-${r.id}`} d={d(r)} />
        ))}
      </defs>

      <rect width="1440" height="800" fill="url(#ef-bloom)" />

      {/* Ribbons: a wide soft band, a mid band and a bright core give the glow without a filter. */}
      {RIBBONS.map((r) => (
        <g key={r.id} fill="none" strokeLinecap="round" opacity={r.tone}>
          <use href={`#ef-path-${r.id}`} stroke="url(#ef-ribbon)" strokeWidth={90 * r.width} strokeOpacity="0.1" />
          <use href={`#ef-path-${r.id}`} stroke="url(#ef-ribbon)" strokeWidth={26 * r.width} strokeOpacity="0.28" />
          <use href={`#ef-path-${r.id}`} stroke="url(#ef-core)" strokeWidth={2.2 * r.width} />
          {motion && (
            <use href={`#ef-path-${r.id}`} pathLength={1000} stroke="#efe8ff" strokeWidth={3.2 * r.width} strokeDasharray="70 930" strokeOpacity="0.85">
              <animate attributeName="stroke-dashoffset" from="1000" to="0" dur={`${r.id === "main" ? 6 : 9}s`} repeatCount="indefinite" />
            </use>
          )}
        </g>
      ))}

      {/* Sparkles: tiny four-point glints that breathe slowly (fixed, faint, few). */}
      {SPARKS.map(([x, y, begin], i) => (
        <path key={i} d={`M ${x} ${y - 7} L ${x + 1.6} ${y - 1.6} L ${x + 7} ${y} L ${x + 1.6} ${y + 1.6} L ${x} ${y + 7} L ${x - 1.6} ${y + 1.6} L ${x - 7} ${y} L ${x - 1.6} ${y - 1.6} Z`} fill="#e9e2ff" opacity={motion ? 0 : 0.35}>
          {motion && <animate attributeName="opacity" values="0;0.8;0" dur="7s" begin={`${begin}s`} repeatCount="indefinite" />}
        </path>
      ))}

      {/* The Fe mark: a brief caption on the main ribbon, not a token or a logo. */}
      {(() => {
        const [x, y] = cubicPoint(RIBBONS[1]!.p, 0.64);
        return (
          <g transform={`translate(${x - 82} ${y - 62})`} opacity={motion ? 0 : 0.9}>
            <rect width="164" height="40" rx="20" fill="#120e2e" fillOpacity="0.82" stroke="#ab98ff" strokeOpacity="0.55" />
            <text x="82" y="26" textAnchor="middle" fill="#ece6ff" fontSize="16" fontWeight="600" letterSpacing="0.2">
              Built with Fe
            </text>
            {motion && <animate attributeName="opacity" values="0;0;0.95;0.95;0" keyTimes="0;0.55;0.62;0.86;0.93" dur="13s" repeatCount="indefinite" />}
          </g>
        );
      })()}

      {/* Coins */}
      {COINS.map((c, i) => {
        const ribbon = RIBBONS.find((r) => r.id === c.ribbon)!;
        if (!motion) {
          const [x, y] = cubicPoint(ribbon.p, c.phase);
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(${c.scale})`} opacity={c.opacity}>
              <Coin />
            </g>
          );
        }
        const begin = `${-c.phase * c.dur}s`;
        return (
          <g key={i} opacity="0">
            <animateMotion dur={`${c.dur}s`} begin={begin} repeatCount="indefinite" rotate="0">
              <mpath href={`#ef-path-${c.ribbon}`} />
            </animateMotion>
            <animate attributeName="opacity" values={`0;${c.opacity};${c.opacity};0`} keyTimes="0;0.07;0.9;1" dur={`${c.dur}s`} begin={begin} repeatCount="indefinite" />
            <g transform={`scale(${c.scale})`}>
              <Coin />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
