import { readFileSync } from "node:fs";
import { runSpike } from "./spike.mjs";
const r = await runSpike({ initHex: readFileSync("../../../out/Settlane.bin", "utf8").trim(), abi: JSON.parse(readFileSync("../../../out/Settlane.abi.json", "utf8")) });
process.exit(r.ok ? 0 : 1);
