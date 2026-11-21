import { REPOSITORY, SETTLANE_ADDRESS, addressUrl } from "@/config/chain";
import { shortHex } from "@/domain/format";
import { Container } from "./Container";
import { Mark } from "./Wordmark";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <Container className="flex flex-col gap-4 py-10 text-sm text-ink-2 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2">
          <Mark size={18} />
          Settlane is an unaudited prototype on the Sepolia testnet. Test ETH only. The verifier is a trusted party.
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <a className="underline decoration-line-control hover:decoration-cobalt" href={REPOSITORY}>
              Source (Apache-2.0)
            </a>
          </li>
          <li>
            <a className="underline decoration-line-control hover:decoration-cobalt" href={addressUrl(SETTLANE_ADDRESS)}>
              Contract <span className="text-data text-[0.8125rem]">{shortHex(SETTLANE_ADDRESS)}</span>
            </a>
          </li>
        </ul>
      </Container>
    </footer>
  );
}
