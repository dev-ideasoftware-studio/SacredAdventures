/**
 * Deep forensic probe (May-11 2026) — single-evaluate version to avoid
 * Five-Server live-reload kicking us mid-probe.
 *
 * Outputs into scratch/forensic-out/:
 *   state.json
 *   01-player-pov.png            (live screenshot, before any offscreen render)
 *   02-pip.png                   (live PiP clip)
 *   03-village-overhead.png      (offscreen ortho top-down, 56 m × 56 m, centred near warren)
 *   04-tipi1-zoom.png            (offscreen ortho top-down, 10 m × 10 m, centred on tipi 1)
 *   05-warren-zoom.png           (offscreen ortho top-down, 6 m × 6 m, centred on warren)
 *   06-tipi1-yaw0.png            (offscreen render of tipi 1 alone with rotation.y temporarily forced to 0 — GLB authoring frame)
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = "http://127.0.0.1:5500/index.v2.html";
const OUT_DIR = "scratch/forensic-out";
const launchArgs = [
  "--use-angle=metal",
  "--enable-webgl",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: launchArgs });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const consoleLog = [];
  page.on("console", (m) => consoleLog.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));

  // Block live-server's auto-reload script so the page can't navigate
  // out from under our probe when an unrelated file write touches the
  // workspace.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/livereload|ws_reconnect|live-server|reload\.js/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // After DOMContentLoaded, kill the WebSocket reload listener if it ever
  // gets through (defence in depth).
  await page.evaluate(() => {
    try {
      if (window.WebSocket) {
        const orig = window.WebSocket;
        window.WebSocket = function NoopWebSocket() {
          return { send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
        };
        // Re-expose original on a side channel so engine code that may need
        // raw sockets can still use it (we don't expect any).
        window.__WebSocketOrig = orig;
      }
    } catch {}
  });
  await page.waitForFunction(
    () => {
      const orc = window.anuOrchestrator;
      const world = orc?._registry?.get("World")?.module;
      const fauna = orc?._registry?.get("Fauna")?.module;
      const rabbitsReady = Array.isArray(fauna?._rabbits) && fauna._rabbits.length >= 5;
      return !!(world?._tipi && world?._tipi2 && rabbitsReady);
    },
    { timeout: 180000 },
  );
  await page.waitForTimeout(2200);

  // 1) Live page screenshot FIRST (before any offscreen renders).
  await page.screenshot({ path: `${OUT_DIR}/01-player-pov.png`, fullPage: false });
  const pipBox = await page
    .$eval("#pipCanvas", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })
    .catch(() => null);
  if (pipBox && pipBox.width > 0 && pipBox.height > 0) {
    await page.screenshot({
      path: `${OUT_DIR}/02-pip.png`,
      clip: {
        x: Math.floor(pipBox.x),
        y: Math.floor(pipBox.y),
        width: Math.ceil(pipBox.width),
        height: Math.ceil(pipBox.height),
      },
    });
  }

  // 2) Single big evaluate: state + 4 offscreen renders.
  const bundle = await page.evaluate(async () => {
    const orc = window.anuOrchestrator;
    if (!orc) return { ERR: "anuOrchestrator missing" };
    const world = orc._registry.get("World").module;
    const fauna = orc._registry.get("Fauna").module;
    const t1 = world._tipi;
    const t2 = world._tipi2;

    const tipiAxesWorld = (t) => {
      t.updateMatrixWorld(true);
      const m = t.matrixWorld.elements;
      const xn = (ax) => {
        const len = Math.hypot(m[ax * 4], m[ax * 4 + 2]) || 1;
        return {
          x: +(m[ax * 4] / len).toFixed(3),
          z: +(m[ax * 4 + 2] / len).toFixed(3),
        };
      };
      return {
        position: { x: +m[12].toFixed(2), z: +m[14].toFixed(2) },
        rotationY: +t.rotation.y.toFixed(4),
        localPlusX_world: xn(0),
        localPlusZ_world: xn(2),
      };
    };

    const ring = document.querySelector(".compass-outer-ring");
    const ringTransform = ring ? ring.style.transform : null;
    const rabbitRoster = fauna._rabbits.map((r) => ({
      id: r.id,
      role: r.role,
      worldX: +r.group.position.x.toFixed(2),
      worldZ: +r.group.position.z.toFixed(2),
      worldY: +r.group.position.y.toFixed(2),
      state: r.state,
      visible: r.group.visible,
    }));

    const npcModelFront = (model) => {
      if (!model) return null;
      model.updateMatrixWorld(true);
      const m = model.matrixWorld.elements;
      const fx = -m[0];
      const fz = -m[2];
      const len = Math.hypot(fx, fz) || 1;
      return { x: +(fx / len).toFixed(3), z: +(fz / len).toFixed(3) };
    };
    const ybModel = t1.userData.ybFacingGroup?.children?.find?.(
      (c) => c.name === "population_npc_yb_model",
    );

    // ── Offscreen renders ──
    const renders = {};
    try {
      const T = await import("three");
      const r = orc.renderer;
      const scene = orc.scene;
      const renderTopDown = (cx, cz, half, size = 1024) => {
        const cam = new T.OrthographicCamera(-half, half, half, -half, 0.1, 400);
        cam.position.set(cx, 200, cz);
        cam.up.set(0, 0, -1); // screen +Y → world -Z (player-spawn direction sits at screen BOTTOM)
        cam.lookAt(cx, 0, cz);
        cam.updateMatrixWorld(true);
        const target = new T.WebGLRenderTarget(size, size);
        r.setRenderTarget(target);
        r.clear();
        r.render(scene, cam);
        const buf = new Uint8Array(size * size * 4);
        r.readRenderTargetPixels(target, 0, 0, size, size, buf);
        r.setRenderTarget(null);
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        const ctx2 = c.getContext("2d");
        const img = ctx2.createImageData(size, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const s = ((size - 1 - y) * size + x) * 4;
            const d = (y * size + x) * 4;
            img.data[d] = buf[s];
            img.data[d + 1] = buf[s + 1];
            img.data[d + 2] = buf[s + 2];
            img.data[d + 3] = buf[s + 3];
          }
        }
        ctx2.putImageData(img, 0, 0);
        target.dispose();
        return c.toDataURL("image/png");
      };
      renders.village = renderTopDown(10.86, -8, 28);
      renders.tipi1 = renderTopDown(0, 0, 5);
      renders.warren = renderTopDown(10.86, 0, 3);

      // Side-view renders of Tipi 1 — to identify the doorway axis
      // empirically. We force the tipi's rotation to 0 (GLB authoring
      // frame) and then look at each of its four cardinal sides.
      const renderSideOfTipi = (label, camPos, lookTarget) => {
        const cam = new T.PerspectiveCamera(40, 1, 0.1, 100);
        cam.position.set(...camPos);
        cam.up.set(0, 1, 0);
        cam.lookAt(...lookTarget);
        cam.updateMatrixWorld(true);
        const target = new T.WebGLRenderTarget(800, 800);
        r.setRenderTarget(target);
        r.clear();
        r.render(scene, cam);
        const buf = new Uint8Array(800 * 800 * 4);
        r.readRenderTargetPixels(target, 0, 0, 800, 800, buf);
        r.setRenderTarget(null);
        const c = document.createElement("canvas");
        c.width = 800;
        c.height = 800;
        const ctx2 = c.getContext("2d");
        const img = ctx2.createImageData(800, 800);
        for (let y = 0; y < 800; y++) {
          for (let x = 0; x < 800; x++) {
            const s = ((800 - 1 - y) * 800 + x) * 4;
            const d = (y * 800 + x) * 4;
            img.data[d] = buf[s];
            img.data[d + 1] = buf[s + 1];
            img.data[d + 2] = buf[s + 2];
            img.data[d + 3] = buf[s + 3];
          }
        }
        ctx2.putImageData(img, 0, 0);
        target.dispose();
        return c.toDataURL("image/png");
      };

      const stash = t1.rotation.y;
      t1.rotation.y = 0; // GLB authoring frame for the side-view set
      t1.updateMatrixWorld(true);
      // Camera 12 m out along each axis at eye-height (4 m up), looking at tipi centre top.
      renders.tipi1_from_localPlusX = renderSideOfTipi(
        "+X",
        [12, 4, 0],
        [0, 4, 0],
      );
      renders.tipi1_from_localMinusX = renderSideOfTipi(
        "-X",
        [-12, 4, 0],
        [0, 4, 0],
      );
      renders.tipi1_from_localPlusZ = renderSideOfTipi(
        "+Z",
        [0, 4, 12],
        [0, 4, 0],
      );
      renders.tipi1_from_localMinusZ = renderSideOfTipi(
        "-Z",
        [0, 4, -12],
        [0, 4, 0],
      );
      t1.rotation.y = stash;
      t1.updateMatrixWorld(true);
    } catch (e) {
      renders.err = "ERR: " + String(e?.message ?? e);
    }

    return {
      world: {
        yaw: +world._yaw.toFixed(3),
        yawDeg: +((world._yaw * 180) / Math.PI).toFixed(1),
        fwd: {
          x: +world._fwd.x.toFixed(3),
          z: +world._fwd.z.toFixed(3),
        },
        playerBody: {
          x: +world._playerBody.position.x.toFixed(2),
          z: +world._playerBody.position.z.toFixed(2),
        },
      },
      compass: { ringTransform },
      tipi1: tipiAxesWorld(t1),
      tipi2: tipiAxesWorld(t2),
      yb: {
        seat: t1.userData.ybSeatRoot
          ? {
              x: +t1.userData.ybSeatRoot.position.x.toFixed(2),
              z: +t1.userData.ybSeatRoot.position.z.toFixed(2),
            }
          : null,
        modelFront: npcModelFront(ybModel),
      },
      rabbits: rabbitRoster,
      warren: fauna._warren
        ? {
            x: +fauna._warren.group.position.x.toFixed(2),
            y: +fauna._warren.group.position.y.toFixed(2),
            z: +fauna._warren.group.position.z.toFixed(2),
            visible: fauna._warren.group.visible,
          }
        : null,
      pip: orc._pipOrtho
        ? {
            width: +(orc._pipOrtho.right - orc._pipOrtho.left).toFixed(2),
          }
        : null,
      _renders: renders,
    };
  });

  if (bundle?.ERR) {
    console.error("STATE ERR:", bundle.ERR);
    fs.writeFileSync(`${OUT_DIR}/console.log`, consoleLog.slice(-300).join("\n"));
    await browser.close();
    process.exit(1);
  }

  const renders = bundle._renders ?? {};
  const clean = { ...bundle };
  delete clean._renders;
  fs.writeFileSync(`${OUT_DIR}/state.json`, JSON.stringify(clean, null, 2));

  const savePng = (name, dataUri) => {
    if (typeof dataUri === "string" && dataUri.startsWith("data:image/png;base64,")) {
      const b64 = dataUri.slice("data:image/png;base64,".length);
      fs.writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(b64, "base64"));
    }
  };
  savePng("03-village-overhead", renders.village);
  savePng("04-tipi1-zoom", renders.tipi1);
  savePng("05-warren-zoom", renders.warren);
  savePng("06-tipi1-from-localPlusX", renders.tipi1_from_localPlusX);
  savePng("07-tipi1-from-localMinusX", renders.tipi1_from_localMinusX);
  savePng("08-tipi1-from-localPlusZ", renders.tipi1_from_localPlusZ);
  savePng("09-tipi1-from-localMinusZ", renders.tipi1_from_localMinusZ);
  fs.writeFileSync(`${OUT_DIR}/console.log`, consoleLog.slice(-300).join("\n"));

  console.log("WROTE", OUT_DIR);
  console.log(JSON.stringify(clean, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
