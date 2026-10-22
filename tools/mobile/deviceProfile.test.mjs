// Equivalence test: js/v2/deviceProfile.js detectMobile() vs the inline rule the
// four former copies used (Orchestrator x2, AnuAdaptiveDpr, gltfLoaderSetup).
// Run from the repo root:  node tools/mobile/deviceProfile.test.mjs
import { detectMobile } from "../../js/v2/deviceProfile.js";

// Verbatim logic of the removed copies (git show 6b8cf51:js/v2/gltfLoaderSetup.js).
function legacy(ua, maxTouchPoints) {
  return (
    /Mobi|Android|iPhone|iPod/i.test(ua) ||
    /iPad/i.test(ua) ||
    (/Macintosh/.test(ua) && (maxTouchPoints || 0) > 1)
  );
}

const UAS = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1",
  ipadOS: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
  empty: "",
};
const TOUCH = [0, 1, 2, 5, undefined];

let checked = 0, failed = 0;
for (const [name, ua] of Object.entries(UAS)) {
  for (const t of TOUCH) {
    checked++;
    const a = legacy(ua, t), b = detectMobile(ua, t);
    if (a !== b) { failed++; console.log(`MISMATCH ${name} touch=${t}: legacy=${a} new=${b}`); }
  }
}
// Spot expectations, so the test also catches a regex that is wrong in both.
const expect = [["iphone", 0, true], ["ipadOS", 5, true], ["ipadOS", 0, false], ["macChrome", 0, false], ["androidTablet", 0, true], ["winChrome", 10, false]];
for (const [n, t, want] of expect) {
  checked++;
  if (detectMobile(UAS[n], t) !== want) { failed++; console.log(`EXPECT ${n} touch=${t}: want ${want}`); }
}
console.log(`deviceProfile.detectMobile: ${checked - failed}/${checked} cases match`);
process.exit(failed ? 1 : 0);
