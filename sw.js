/**
 * Sacred Adventures — Service Worker
 * ===================================
 * Two-tier caching for offline play:
 *   1. SHELL: HTML, JS, CSS, vendor files — precached on install
 *   2. ASSETS: GLB, OBJ, textures, media — cached on first fetch (cache-first)
 * 
 * Bump CACHE_VERSION to force a full re-cache on next visit.
 */

const CACHE_VERSION = "v34";
const SHELL_CACHE = `sacred-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `sacred-assets-${CACHE_VERSION}`;

// Shell files: small, critical for boot — precached on install
const SHELL_FILES = [
  "./",
  "./index.html",
  "./SacredGame.Panel.html",
  "./SacredGame.Journal.html",
  "./js/components/Component.NewJournal.html",
  "./SacredGame.css",
  "./manifest.json",

  // Core JS
  "./js/EngineMain.js",
  "./js/EnvironmentBuilder.js",
  "./js/MasterAI.js",
  "./js/MasterNPCAI.js",
  "./js/GameObjectsDatabase.js",
  "./js/Universe.Anu.js",
  "./js/Component.PostProcessing.js",
  "./js/Component.HerdSystem.js",
  "./js/Component.RabbitSystem.js",
  "./js/components/Component.ThreeIcons.js",
  "./js/components/Component.LoadingModal.html",
  "./js/components/Component.MoonDial.html",

  // Data JS
  "./Assets/AxeData.js",
  "./js/Data.Fish.js",

  // Small Assets (UI)
  "./Assets/SacredOnes.Avatar.A.png",

  // Vendor: Three.js
  "./vendor/three/three.module.js",
  "./vendor/three/three.r128.min.js",
  "./vendor/three/examples/jsm/loaders/GLTFLoader.js",
  "./vendor/three/examples/jsm/loaders/OBJLoader.js",
  "./vendor/three/examples/jsm/loaders/MTLLoader.js",
  "./vendor/three/examples/jsm/loaders/RGBELoader.js",
  "./vendor/three/examples/jsm/utils/SkeletonUtils.js",
  "./vendor/three/examples/jsm/utils/BufferGeometryUtils.js",
  "./vendor/three/examples/jsm/postprocessing/EffectComposer.js",
  "./vendor/three/examples/jsm/postprocessing/RenderPass.js",
  "./vendor/three/examples/jsm/postprocessing/ShaderPass.js",
  "./vendor/three/examples/jsm/postprocessing/BokehPass.js",
  "./vendor/three/examples/jsm/postprocessing/MaskPass.js",
  "./vendor/three/examples/jsm/postprocessing/Pass.js",
  "./vendor/three/examples/jsm/shaders/BokehShader.js",
  "./vendor/three/examples/jsm/shaders/CopyShader.js",
  "./vendor/three/examples/jsm/objects/Lensflare.js",

  // Vendor: FontAwesome
  "./vendor/fa/all.min.css",
  "./vendor/fa/webfonts/fa-solid-900.woff2",
  "./vendor/fa/webfonts/fa-regular-400.woff2",
  "./vendor/fa/webfonts/fa-brands-400.woff2",

  // Vendor: Fonts
  "./vendor/fonts/google-fonts.css",

  // Vendor: Other
  "./vendor/lucide/lucide.min.js",
  "./vendor/textures/cream-paper.png",

  // Small assets
  "./Assets/pwa-icon.png",
  "./Assets/Journal.Cover.png",
  "./Assets/birdsong.mp3",
  "./Assets/AnimatedOpening.mp4",

  // v4 Sanctuary GLBs — pre-warm the asset cache on install so first load
  // doesn't stall on these (they're large and hit the render path immediately)
  "./Assets/tree.glb",
  "./Assets/bush.glb",
  "./Assets/pond1.glb",
  "./Assets/Avatar3.glb",
  "./Assets/flora/reeds.glb",
  "./Assets/frog.png",
  "./Assets/bark.png",
  "./Assets/water.png",
  "./Assets/grass_seamless.png",
  "./Assets/rock.png",
];

// Install: precache shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log('[SW] Precaching shell files...');
      return cache.addAll(SHELL_FILES).catch((err) => {
        console.warn('[SW] Some shell files failed to cache (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: delete old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== SHELL_CACHE && name !== ASSET_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for all requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // For HTML files with cache-buster ?v= params, strip the query and serve from cache
  if (url.search.includes("v=") && url.pathname.endsWith(".html")) {
    const cleanRequest = new Request(url.origin + url.pathname);
    event.respondWith(
      caches.match(cleanRequest).then((cached) => {
        if (cached) return cached;
        return fetch(cleanRequest).catch(
          () => new Response("", { status: 404, statusText: "Offline" }),
        );
      }),
    );
    return;
  }

  // Skip cache-busted JS/CSS requests (let them hit network for fresh code)
  if (url.search.includes("v=")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .match(new Request(url.origin + url.pathname))
          .then(
            (res) =>
              res || new Response("", { status: 404, statusText: "Offline" }),
          ),
      ),
    );
    return;
  }

  // Large assets (GLB, OBJ, textures): runtime cache-first
  const isAsset = /\.(glb|obj|png|jpg|jpeg|mp3|mp4|woff2|ttf)$/i.test(
    url.pathname,
  );

  if (isAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            // Only cache full 200 responses — skip 206 partials (video range requests)
            if (response.status === 200) {
              const clone = response.clone();
              caches
                .open(ASSET_CACHE)
                .then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(
            () =>
              new Response("", {
                status: 404,
                statusText: "Offline - Asset not cached",
              }),
          );
      }),
    );
    return;
  }

  // Shell files: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Fallback: serve index.html for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("", { status: 404, statusText: "Offline" });
        });
    })
  );
});
