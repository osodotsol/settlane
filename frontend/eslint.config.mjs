import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "src/contract/abi.ts", "spikes/**", "e2e/screenshots/**", ".next-e2e-*/**", "test-results/**", ".vercel/**"] },
];

export default config;
