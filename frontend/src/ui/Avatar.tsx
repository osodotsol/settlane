import { IDENTICON_COLORS, identiconOf } from "@/domain/identicon";

/** A small deterministic identicon for an address. Decorative: hidden from assistive technology. */
export function Avatar({ address, size = 32 }: { address: string; size?: number }) {
  const { cells, colorIndex } = identiconOf(address);
  const color = IDENTICON_COLORS[colorIndex]!;
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" aria-hidden className="shrink-0 rounded-lg bg-sunken" shapeRendering="crispEdges">
      {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
    </svg>
  );
}
