import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const failures = [];
page.on("response", (resp) => {
  if (resp.status() >= 400) failures.push({ url: resp.url(), status: resp.status() });
});
await page.goto("http://127.0.0.1:5500/index.v4.html", { waitUntil: "load" });
await page.waitForFunction(() => !!window.anuOrchestrator?._activeModules?.includes("SanctuaryInventory"), { timeout: 90000 });
await page.waitForTimeout(5000);
// Trigger the panel + journal so their iframes try to load all their assets
await page.evaluate(() => { window._v4TogglePanel?.(); });
await page.waitForTimeout(2500);
await page.evaluate(() => { window._v4ToggleJournal?.(); });
await page.waitForTimeout(2500);
console.log(JSON.stringify({ count: failures.length, failures: failures.slice(0, 40) }, null, 2));
await browser.close();
