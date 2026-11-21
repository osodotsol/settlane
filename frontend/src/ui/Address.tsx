import { ExternalLink } from "lucide-react";
import { addressUrl } from "@/config/chain";
import { shortHex } from "@/domain/format";
import { CopyButton } from "./CopyButton";

/** An address in mono, elided in the middle, with copy, an Etherscan link and an optional role. */
export function Address({ address, role }: { address: string; role?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {role && <span className="mr-1 rounded-full bg-sunken px-2 py-0.5 text-micro text-ink-2">{role}</span>}
      <span className="text-data" title={address}>
        <span aria-hidden>{shortHex(address)}</span>
        <span className="sr-only">{address}</span>
      </span>
      <CopyButton value={address} label={role ? `${role} address` : "address"} />
      <a
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
        aria-label={`View ${role ?? "address"} on Sepolia Etherscan (opens in a new tab)`}
      >
        <ExternalLink aria-hidden size={15} />
      </a>
    </span>
  );
}
