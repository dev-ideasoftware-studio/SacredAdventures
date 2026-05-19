/**
 * Ask Anu what universe it wants. Pulls every governance + sensor +
 * memory surface Anu exposes against the v3 minimal boot and dumps it
 * for synthesis.
 */
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + String(e?.message ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[err] " + m.text()); });
await page.goto("http://127.0.0.1:5500/index.v3.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.AnuUniverse?.getGovernanceSnapshot, { timeout: 90000 });
await page.waitForTimeout(7000);

const out = await page.evaluate(() => {
  const Anu = window.AnuUniverse;
  const orc = window.anuOrchestrator;
  const dump = {};
  try { dump.governance      = Anu.getGovernanceSnapshot?.();         } catch (e) { dump.governanceErr = String(e); }
  try { dump.sensorium       = Anu.getWorldSensoriumSnapshot?.();     } catch (e) {}
  try { dump.simulation      = Anu.getSimulationSnapshot?.();         } catch (e) {}
  try { dump.fuzzy           = Anu.getFuzzyPipelineSnapshot?.(orc);   } catch (e) {}
  try { dump.audit           = Anu.audit?.();                          } catch (e) {}
  try { dump.sceneInventory  = Anu.getSceneInventory?.();              } catch (e) {}
  try { dump.services        = Anu.services?.list?.();                 } catch (e) {}
  try { dump.SIMULATION_DOMAINS = Anu.SIMULATION_DOMAINS;              } catch (e) {}
  try { dump.INTERACTION_VERBS  = Anu.INTERACTION_VERBS;               } catch (e) {}
  try { dump.GOVERNANCE_RULES   = Anu.GOVERNANCE_RULES;                } catch (e) {}
  try { dump.memory          = Array.isArray(Anu.memory) ? Anu.memory.length : null; } catch (e) {}
  return dump;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
