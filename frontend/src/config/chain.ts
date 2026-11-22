import { getAddress } from "viem";
import { sepolia } from "viem/chains";

// Everything here is public configuration (frontend/PLAN.md §3). No key, keystore or project id
// exists in the frontend. Values can be overridden with NEXT_PUBLIC_* variables; the defaults are
// the verified Sepolia deployment (docs/RELEASE.md, experiments/sepolia/artifact.json).

export const CHAIN = sepolia;

export const SETTLANE_ADDRESS = getAddress(
  process.env.NEXT_PUBLIC_SETTLANE_ADDRESS ?? "0xf79d229a039bf5c84ecc7327060f8bbc888d2182",
);

/** Block of the deployment transaction: event history is read from here. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "12175958");

/** Deployment transaction (README "Demo" table). */
export const DEPLOY_TX = "0x4309d7c7fc7b4f68820efe6da17d50381a822e1d656c607a31a58d4384598537" as const;

/** Compiler that built the deployed bytecode (experiments/sepolia/artifact.json "fe"). */
export const FE_VERSION = "fe 26.6.0 (5b3f96a)";

/** SHA-256 of the deployed runtime code, equal to a clean `fe build` (pinned in experiments/sepolia/artifact.json). */
export const RUNTIME_SHA256 = "f0965efd4e9d2a0fcfd0eae88d5e6e9c0a938b22c03949b54f015b2600f4b3a8";

/** Public, keyless, CORS-enabled Sepolia endpoints (verified 2026-11-21); the first is primary. */
export const RPC_URLS: readonly string[] = (
  process.env.NEXT_PUBLIC_RPC_URLS ??
  "https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co"
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

/**
 * Where event LOGS are read from, in order. Public nodes prune old logs: publicnode answers "pruned history
 * unavailable" for ranges whose logs are older than a few thousand blocks (docs/EVENT_HISTORY.md), while Tenderly
 * and the Ethereum Foundation's ethpandaops node returned them (verified, not assumed). Logs older than the verified
 * snapshot are never needed from these; they only cover the blocks after it. If NEXT_PUBLIC_RPC_URLS is set (the
 * local test chain) the same endpoints serve logs, and NEXT_PUBLIC_HISTORY_RPC_URLS overrides both.
 */
export const HISTORY_RPC_URLS: readonly string[] = (
  process.env.NEXT_PUBLIC_HISTORY_RPC_URLS ??
  (process.env.NEXT_PUBLIC_RPC_URLS ? process.env.NEXT_PUBLIC_RPC_URLS : [...RPC_URLS, "https://rpc.sepolia.ethpandaops.io"].join(","))
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

export const BLOCK_EXPLORER = "https://sepolia.etherscan.io";

/** Hosted CI (GitHub Actions) for the repository. */
export const CI_URL = "https://github.com/osodotsol/settlane/actions";

export const REPOSITORY = "https://github.com/osodotsol/settlane";

export const txUrl = (hash: string) => `${BLOCK_EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${BLOCK_EXPLORER}/address/${address}`;
