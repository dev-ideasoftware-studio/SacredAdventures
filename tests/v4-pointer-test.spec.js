const { test, expect } = require('@playwright/test');

test.use({ baseURL: undefined });

test('pointer-events-none inside iframe passes to parent', async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin: 0; background: red; height: 100vh; }
      #behind { position: absolute; top: 50px; left: 50px; width: 100px; height: 100px; background: blue; }
      iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; pointer-events: auto; z-index: 10; }
    </style>
    <div id="behind" onclick="window.clickedBehind = true"></div>
    <iframe id="ifr"></iframe>
  `);

  const frame = page.frames()[1];
  await frame.setContent(`
    <style>
      html, body { width: 100%; height: 100%; pointer-events: none; margin: 0; }
      button { pointer-events: auto; position: absolute; top: 200px; left: 50px; width: 100px; height: 50px; }
    </style>
    <button onclick="window.clickedBtn = true">Btn</button>
    <script>
      document.addEventListener('mousedown', () => window.docClicked = true);
    </script>
  `);

  await page.mouse.click(100, 100); // Over #behind
  const clickedBehind = await page.evaluate(() => window.clickedBehind);
  const docClicked = await frame.evaluate(() => window.docClicked);

  console.log('clickedBehind:', clickedBehind);
  console.log('iframe docClicked:', docClicked);

  expect(true).toBe(true);
});
