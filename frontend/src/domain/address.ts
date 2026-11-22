import { getAddress, isAddress, type Address } from "viem";

// Address input that protects against typos (R2 audit M2). EIP-55 encodes a checksum in the capitalization of an
// address: a mixed-case address whose capitalization does not match was mistyped or altered, and is rejected. An
// all-lowercase (or all-uppercase) address carries no checksum: it is accepted, unchanged in meaning, with a warning
// that a typo cannot be detected. The zero address is never accepted. Nothing is "corrected": the account an input
// names is exactly the account used.

export type AddressCheck = { ok: true; address: Address; warning?: string } | { ok: false; error: string };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function checkAddress(input: string, what = "address"): AddressCheck {
  const s = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return { ok: false, error: `Enter the ${what} (0x followed by 40 hexadecimal characters).` };
  if (/^0x0{40}$/i.test(s)) return { ok: false, error: `The ${what} cannot be the zero address.` };
  const body = s.slice(2);
  const unprotected = body === body.toLowerCase() || body === body.toUpperCase();
  if (!unprotected && !isAddress(s, { strict: true })) {
    return { ok: false, error: `This ${what} fails its checksum (EIP-55): its capitalization does not match, so it may contain a typo. Copy it again from its source.` };
  }
  return {
    ok: true,
    address: getAddress(s.toLowerCase()),
    warning: unprotected ? `This ${what} is all one case, so it carries no checksum and a typo cannot be detected. Check every character.` : undefined,
  };
}
