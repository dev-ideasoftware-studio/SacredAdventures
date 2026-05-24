/**
 * Inject an addInitScript that hijacks every reload trigger before the
 * page boots. We log who/what tries to reload and PREVENT the reload, so
 * we can see all the attempts during a 30 s window without losing context.
 */
const { test } = require('@playwright/test');

test.use({ baseURL: undefined });

test('v4 sanctuary — trace EVERY reload attempt', async ({ page }) => {
  const reloads = [];
  const wsMessages = [];

  await page.exposeFunction('__reportReload', (info) => reloads.push(info));
  await page.exposeFunction('__reportWS',     (info) => wsMessages.push(info));

  await page.addInitScript(() => {
    const origReload = window.location.reload.bind(window.location);
    window.location.reload = function () {
      const stack = new Error('reload-trace').stack;
      window.__reportReload({ kind: 'location.reload', stack });
      // DO NOT call origReload — we want to see all attempts in one window
    };
    // Also catch hash / href assignments
    const origAssign = window.location.assign.bind(window.location);
    window.location.assign = function (url) {
      window.__reportReload({ kind: 'location.assign', url });
    };
    // Hijack WebSocket to log any "reload" messages from live-server
    const OrigWS = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new OrigWS(...args);
      const origOnmessage = Object.getOwnPropertyDescriptor(OrigWS.prototype, 'onmessage');
      ws.addEventListener('message', (ev) => {
        window.__reportWS({ url: String(args[0]), data: String(ev.data).slice(0, 200) });
      });
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
  });

  await page.goto('http://127.0.0.1:5505/index.v4.html', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(30000);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RELOAD TRACE — 30 s window                          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log(`Reload attempts: ${reloads.length}`);
  reloads.forEach((r, i) => {
    console.log(`\n  [${i + 1}] kind=${r.kind}${r.url ? ' url=' + r.url : ''}`);
    if (r.stack) {
      console.log('    Stack (first 8 frames):');
      r.stack.split('\n').slice(0, 8).forEach(l => console.log('      ' + l.trim()));
    }
  });

  console.log(`\nWebSocket messages received: ${wsMessages.length}`);
  wsMessages.slice(0, 20).forEach((w, i) => {
    console.log(`  [${i + 1}] ${w.url}  ←  "${w.data}"`);
  });
});
