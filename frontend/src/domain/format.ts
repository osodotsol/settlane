import { formatEther } from "viem";

/** `0xf79d…2182`: elided in the middle, never at the end (DESIGN.md §3). */
export function shortHex(hex: string, lead = 6, tail = 4): string {
  if (hex.length <= lead + tail + 1) return hex;
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}

/**
 * ETH from wei with at most `maxDecimals` decimals, truncated (never rounded up), so a displayed
 * amount never exceeds the real one. A nonzero amount below the smallest step is shown as "< 0.000001".
 */
export function formatEth(wei: bigint, maxDecimals = 6): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const [whole, frac = ""] = formatEther(abs).split(".");
  const cut = frac.slice(0, maxDecimals).replace(/0+$/, "");
  if (abs !== 0n && whole === "0" && cut === "") return `< 0.${"0".repeat(maxDecimals - 1)}1`;
  const body = cut ? `${whole}.${cut}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/** `2026-11-20 16:12 UTC` from unix seconds. Deadlines are always shown in absolute UTC. */
export function formatUtc(seconds: bigint): string {
  const d = new Date(Number(seconds) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** "in 3 h 12 min" / "2 d ago" between two unix-second instants (the reference is block time). */
export function formatRelative(target: bigint, now: bigint): string {
  const diff = Number(target - now);
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400, "d"],
    [3_600, "h"],
    [60, "min"],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [size, label] of units) {
    if (rest >= size && parts.length < 2) {
      parts.push(`${Math.floor(rest / size)} ${label}`);
      rest %= size;
    }
  }
  const text = parts.length ? parts.join(" ") : `${abs} s`;
  if (diff === 0) return "now";
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
