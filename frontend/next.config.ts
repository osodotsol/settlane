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
  // Next's default metadata streaming for browsers is kept (R2 H1: forcing blocking rendering for every client made a
  // slow node hold the whole response). Unknown agreements still get a real HTTP 404 from src/proxy.ts before rendering,
  // and every server read is time-bounded (src/chain/budget.ts), so pages stay complete without JavaScript.
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
