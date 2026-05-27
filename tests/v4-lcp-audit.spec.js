/**
 * v4-lcp-audit.spec.js
 * Playwright audit test to measure Largest Contentful Paint (LCP)
 * and analyze render delays.
 */
const { test, expect } = require('@playwright/test');

test('v4 sanctuary — LCP and render delay audit', async ({ page }) => {
  // Set up PerformanceObserver BEFORE page loads to capture the earliest paint event
  await page.addInitScript(() => {
    window.lcpDataPromise = new Promise(resolve => {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        resolve({
          element: last.element?.tagName ?? "unknown",
          id: last.element?.id ?? "none",
          className: last.element?.className ?? "none",
          url: last.url ?? "none",
          startTime: last.startTime,
          renderTime: last.renderTime,
          loadTime: last.loadTime,
          size: last.size,
        });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
  });

  console.log("Navigating to index.html to audit boot LCP...");
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  // Wait 12 seconds for full boot to complete
  await page.waitForTimeout(12000);

  // Retrieve the LCP timings captured during boot
  const lcp = await page.evaluate(async () => {
    return window.lcpDataPromise ? await window.lcpDataPromise : null;
  });

  console.log('\n══════════════════════════════════════════════════════');
  console.log('       LARGEST CONTENTFUL PAINT (LCP) AUDIT');
  console.log('══════════════════════════════════════════════════════\n');

  if (lcp) {
    console.log(`LCP Timing:    ${lcp.startTime.toFixed(1)} ms`);
    console.log(`LCP Element:   <${lcp.element}>`);
    console.log(`LCP ID:        #${lcp.id}`);
    console.log(`LCP Class:     .${lcp.className}`);
    console.log(`LCP Size:      ${lcp.size}px`);
    console.log(`LCP Resource:  ${lcp.url}`);
    
    // Assert LCP is healthy (Google standard is < 2.5 seconds, i.e., 2500ms)
    console.log('\nAsserting LCP timing matches Core Web Vitals target...');
    expect(lcp.startTime).toBeLessThan(2500);
    console.log('✅ PASS: LCP is under the 2500ms CWV target!');
  } else {
    console.log('❌ LCP data could not be captured. PerformanceObserver timed out or failed.');
    throw new Error('LCP capture failed.');
  }
  console.log('\n══════════════════════════════════════════════════════\n');
});
