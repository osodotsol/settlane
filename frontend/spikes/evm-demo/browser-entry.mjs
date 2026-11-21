import initHex from "../../../out/Settlane.bin";
import abi from "../../../out/Settlane.abi.json";
import { runSpike } from "./spike.mjs";
const out = [];
const r = await runSpike({ initHex: initHex.trim(), abi, log: (l) => out.push(l) });
globalThis.__spike = { ...r, out };
document.title = r.ok ? "SPIKE-OK" : "SPIKE-FAIL";
document.body.textContent = out.join("\n");
