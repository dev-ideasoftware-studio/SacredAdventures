
        import * as THREE_module from 'three';
        import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
        import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
        import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
        import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

        // A. Globally Expose Loaders for sub-modules
        window.THREE = Object.assign({}, THREE_module);
        window.OBJLoader = OBJLoader;
        window.MTLLoader = MTLLoader;
        window.GLTFLoader = GLTFLoader;
        window.SkeletonUtils = SkeletonUtils;
        window.BufferGeometryUtils = BufferGeometryUtils;

        // Ensure THREE namespace has loaders attached for older scripts
        window.THREE.OBJLoader = OBJLoader;
        window.THREE.MTLLoader = MTLLoader;
        window.THREE.GLTFLoader = GLTFLoader;
        window.THREE.DRACOLoader = DRACOLoader;

        // B. Inject Game Components as classic scripts to avoid CORS on file://
        // CACHE BUSTER ADDED: Append a timestamp to prevent the browser from serving stale 18FPS cached files
        const loadScript = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            const cacheBuster = `?v=1776936947${new Date().getTime()}`;
            s.src = src.includes('?') ? src + `&v=1776936947${new Date().getTime()}` : src + cacheBuster;
            s.async = false; // CRITICAL: Guarantee execution order of Promise.all array!
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });

        Promise.all([
            loadScript('Component.FuzzyBrain.js'),
            loadScript('js/MasterAI.js'),
            loadScript('js/Component.PostProcessing.js'),
            loadScript('js/Component.RabbitSystem.js'),
            loadScript('js/Component.BirdSystem.js'),
            loadScript('js/Component.HerdSystem.js'),
            loadScript('js/EnvironmentBuilder.js'),
            loadScript('Component.AssetFactory.js'),
            loadScript('Component.ThreeIcons.js')
        ]).then(() => {
            // C. Signal Ready
            window.customScriptsReady = true;
            if (window.documentReady) window.startGameIfReady();
        }).catch(err => {
            console.error("Failed to load game components via script injection:", err);
        });
    