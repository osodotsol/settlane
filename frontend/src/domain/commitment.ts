import { isHex, keccak256, stringToBytes } from "viem";

// Evidence and milestone specifications are stored on-chain only as 256-bit commitments (the contract
// never sees the files). The interface accepts either a 32-byte hash the user already has, or plain text,
// which is committed as keccak256 of its UTF-8 bytes. Zero is never a valid commitment (`evidence is zero`,
// `milestone spec is zero`), so a zero hash is refused here as well.

export type Commitment = { ok: true; value: bigint; hex: `0x${string}`; from: "hash" | "text" } | { ok: false; error: string };

export function commit(input: string): Commitment {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Enter text, or a 32-byte hash starting with 0x." };
  if (isHex(text, { strict: true }) && text.length === 66) {
    const value = BigInt(text);
    if (value === 0n) return { ok: false, error: "The hash cannot be all zeros." };
    return { ok: true, value, hex: text.toLowerCase() as `0x${string}`, from: "hash" };
  }
  if (/^0x/i.test(text) && /^[0-9a-fx]*$/i.test(text)) return { ok: false, error: "A hash is 0x followed by 64 hexadecimal characters. Remove the 0x to commit it as text." };
  const hex = keccak256(stringToBytes(text));
  return { ok: true, value: BigInt(hex), hex, from: "text" };
}
