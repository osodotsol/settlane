import type { NextConfig } from "next";

// Public RPC hosts the browser may call (docs: frontend/PLAN.md §3, §9). Nothing secret is configured here.
const RPC_HOSTS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co", "https://rpc.sepolia.ethpandaops.io"];
// The end-to-end runner points the browser at a local node through NEXT_PUBLIC_RPC_URLS; allow exactly those origins.
for (const url of `${process.env.NEXT_PUBLIC_RPC_URLS ?? ""},${process.env.NEXT_PUBLIC_HISTORY_RPC_URLS ?? ""}`.split(",")) {
  try {
    const origin = new URL(url.trim()).origin;
    if (!RPC_HOSTS.includes(origin)) RPC_HOSTS.push(origin);
  } catch {
    /* not a URL: ignore */
  }
}

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; 'unsafe-eval' only in development (React refresh).
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${RPC_HOSTS.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise writes frontend/AGENTS.md into the repository on every start.
  agentRules: false,
  // The end-to-end runner (e2e/run.mjs) builds one app per backend (Sepolia, local Anvil) side by side.
  distDir: process.env.SETTLANE_DIST_DIR ?? ".next",
  // e2e builds use a generated tsconfig (e2e/run.mjs), so Next never rewrites the committed one.
  typescript: { tsconfigPath: process.env.SETTLANE_DIST_DIR ? "tsconfig.e2e.json" : "tsconfig.json" },
  // Resolve metadata before streaming for every client (not only bots), so a missing agreement gets a
  // real HTTP 404 and pages are complete without JavaScript (Next streams metadata to browsers by default).
  htmlLimitedBots: /.*/,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
