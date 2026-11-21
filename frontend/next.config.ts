import type { NextConfig } from "next";

// Public RPC hosts the browser may call (docs: frontend/PLAN.md §3, §9). Nothing secret is configured here.
const RPC_HOSTS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.gateway.tenderly.co"];

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
