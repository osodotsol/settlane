// The generated ABI (src/contract/abi.ts) for plain Node scripts: it is a JSON array behind one TS line.
import { readFileSync } from "node:fs";
export function settlaneAbiJson() {
  const src = readFileSync(new URL("../src/contract/abi.ts", import.meta.url), "utf8");
  return JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
}
