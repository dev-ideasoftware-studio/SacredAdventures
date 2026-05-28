const { test, expect, devices } = require('@playwright/test');

const VIEWPORTS = [
  { name: 'iPhone 14',        w: 390,  h: 844,  touch: true  },
  { name: 'iPad Pro 12.9 landscape', w: 1366, h: 1024, touch: true  },
  { name: 'Desktop 1920',     w: 1920, h: 1080, touch: false },
];

for (const vp of VIEWPORTS) {
  test(`Guide cards — ${vp.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: vp.touch,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('http://127.0.0.1:5505/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    const frame = page.frame({ url: /SacredGame\.Panel\.html/ }) || page.mainFrame();
    const card = frame.locator('.guide-card').first();
    await expect(card).toBeVisible({ timeout: 6000 });

    const box = await card.boundingBox();
    const desc = frame.locator('.card-desc').first();
    const descVisible = await desc.isVisible();
    const descDisplay = await desc.evaluate(el => getComputedStyle(el).display);

    console.log(`[${vp.name}] card ${Math.round(box.width)}×${Math.round(box.height)}px  card-desc display:${descDisplay} visible:${descVisible}`);

    if (vp.touch) {
      // compact: desc must be hidden
      expect(descDisplay, `card-desc should be hidden on touch device`).toBe('none');
      expect(box.width).toBeLessThan(80);
    } else {
      // desktop: desc may show
      console.log('  (desktop — desc visible is expected)');
    }

    await page.screenshot({ path: `backups/guide-cards-${vp.name.replace(/\s+/g,'-')}.png` });
    expect(errors).toHaveLength(0);
    await ctx.close();
  });
}
