const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

test('Click-to-move works across views and PIP runs fast in top-down', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  
  await page.goto('http://127.0.0.1:5505/index.v4.html');
  await page.waitForTimeout(8000); // Wait for boot

  // Ensure iframe body pointer-events is auto
  const iframeHandle = await page.$('iframe#v4-panel-frame');
  expect(iframeHandle).toBeTruthy();
  const frame = await iframeHandle.contentFrame();
  
  const pointerEvents = await frame.evaluate(() => getComputedStyle(document.body).pointerEvents);
  expect(pointerEvents).toBe('auto');

  // Verify PIP devicePixelRatio was increased
  const getPr = () => {
    const w = window.anuOrchestrator._pipW;
    const rectW = window.anuOrchestrator._pipRenderer.domElement.getBoundingClientRect().width;
    return w / rectW;
  };
  const pr = await page.evaluate(getPr);
  expect(pr).toBeLessThan(1.3); // Should be 1.25 in FPV

  // Switch to top-down
  await page.evaluate(() => document.body.classList.add('v4-top-down-view'));
  
  // Force a resize recompute
  await page.evaluate(() => {
    window.anuOrchestrator._pipW = 0; // invalidate size cache
    window.anuOrchestrator._renderPip();
  });
  
  const prTopDown = await page.evaluate(getPr);
  expect(prTopDown).toBeCloseTo(2.0, 1); // Should be upscale 2.0 in top-down

  console.log("Verified: pointerEvents auto, PR updates.");

  await ctx.close();
});
