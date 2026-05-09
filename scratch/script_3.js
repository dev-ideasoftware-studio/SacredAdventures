
        // LOG SYSTEM HELPER: Routes telemetry to the diagnostic HUD
        window.logSystem = function (msg, pVideo, pAssets, pLogic, pInit) {
            const ld = document.getElementById('loading-iframe');
            if (ld && ld.contentWindow) {
                ld.contentWindow.postMessage({
                    type: 'LOG_SYSTEM',
                    msg, pVideo, pAssets, pLogic, pInit
                }, '*');
            }
            if (msg) console.log(`[System] ${msg}`);
        };

        // BOOTSTRAP ORCHESTRATION
        let isEngineStarted = false;
        window.addEventListener('message', (event) => {
            if (event.data.type === 'VIDEO_READY' && !isEngineStarted) {
                isEngineStarted = true;
                logSystem("Downloading...", 100, 0, 0, 0);

                // Start Asset Preload
                const npcScript = document.createElement('script');
                npcScript.src = 'js/MasterNPCAI.js?v=1';
                document.body.appendChild(npcScript);

                const dbScript = document.createElement('script');
                dbScript.src = 'js/GameObjectsDatabase.js?v=1';
                dbScript.onload = () => {
                    logSystem("Loading...", 100, 15, 0, 0);
                    
                    const anuScript = document.createElement('script');
                    anuScript.src = 'js/Universe.Anu.js?v=' + Date.now();
                    anuScript.onload = () => {
                        const engineScript = document.createElement('script');
                        engineScript.type = 'module';
                        engineScript.src = 'js/EngineMain.js?v=' + Date.now();
                        engineScript.onload = () => {
                            logSystem("Processing...", 100, 30, 0, 0);
                            window.customScriptsReady = true;
                            if (window.startGameIfReady) window.startGameIfReady();
                        };
                        document.body.appendChild(engineScript);
                    };
                    document.body.appendChild(anuScript);
                };
                document.body.appendChild(dbScript);
            }
        });
    