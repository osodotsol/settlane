// A deterministic identicon for an address: a 5x5 mirrored grid from the address bytes, in one of six
// token colours. It is decoration only (always aria-hidden) and carries no meaning, so it never replaces
// the address, the role label or the state colours.

export type Identicon = { cells: boolean[][]; colorIndex: number };

export function identiconOf(address: string): Identicon {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const bytes = Array.from({ length: 20 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0);
  const cells: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    const left = [0, 1, 2].map((col) => {
      const bit = row * 3 + col;
      return ((bytes[bit % 20]! >> (bit % 8)) & 1) === 1;
    });
    // mirror the first three columns to the last two
    cells.push([left[0]!, left[1]!, left[2]!, left[1]!, left[0]!]);
  }
  return { cells, colorIndex: (bytes[18]! + bytes[19]!) % 6 };
}

export const IDENTICON_COLORS = [
  "var(--state-funded)",
  "var(--state-submitted)",
  "var(--state-approved)",
  "var(--state-paid)",
  "var(--state-refunded)",
  "var(--cobalt)",
] as const;
