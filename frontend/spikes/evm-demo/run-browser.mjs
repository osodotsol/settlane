import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const p = req.url === "/" ? "/index.html" : req.url;
  try { res.writeHead(200, { "content-type": types[p.slice(p.lastIndexOf("."))] ?? "text/plain" }); res.end(readFileSync("." + p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => document.title.startsWith("SPIKE-"), null, { timeout: 60_000 });
const wall = Date.now() - t0;
const r = await page.evaluate(() => globalThis.__spike);
const nav = await page.evaluate(() => { const e = performance.getEntriesByType("resource").find((x) => x.name.endsWith("spike.js")); return e ? { transfer: e.transferSize, decoded: e.decodedBodySize, ms: Math.round(e.duration) } : null; });
console.log(`browser: ${browser.version()} | result: ${r.ok ? "ALL PASS" : "FAIL"} | checks: ${r.out.filter((l) => l.startsWith("PASS")).length}/${r.out.length - 1}`);
console.log(`in-browser timing: createVM ${r.tVm.toFixed(0)} ms, deploy ${r.tDeploy.toFixed(0)} ms, 12-step script ${r.tScript.toFixed(0)} ms | page load to done ${wall} ms | bundle ${JSON.stringify(nav)}`);
if (!r.ok) console.log(r.out.join("\n"));
if (errors.length) console.log("errors:", errors);
await browser.close(); server.close();
