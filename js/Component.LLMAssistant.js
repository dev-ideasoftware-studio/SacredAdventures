/**
 * Component.LLMAssistant.js
 * 
 * Local Game Master / Regex Parser for the Sacred Adventures HUD interaction pipeline.
 * Intercepts strings from the Logbook's `llm-input` field and maps natural language
 * intent to explicit global game events (e.g. 'START_AUTO_WALK').
 */

class LLMAssistant {
    constructor() {
        this.initialized = true;
        
        // Define standard regex intent maps
        this.intents = [
            {
                // Trigger: "Start Game", "Begin", "Play", "Let's Go"
                pattern: /\b(start( game)?|begin|play( game)?|let'?s go)\b/i,
                action: () => this.dispatchGameEvent('REQ_START_AUTO_WALK')
            },
            {
                // Trigger: "Go to tipi", "Find her", "Find daughter", "Walk to tipi"
                pattern: /\b(go to (the )?tipi|find her|find( the)? daughter|walk to (the )?tipi)\b/i,
                action: () => this.dispatchGameEvent('REQ_FIND_HER_AUTOWALK', { target: 'bhg' })
            },
            {
                // Trigger: "Get axe", "Take axe", "Pick up axe"
                pattern: /\b(get( the)? axe|take( the)? axe|pick up( the)? axe)\b/i,
                action: () => this.dispatchGameEvent('REQ_GATHER_AXE')
            },
            {
                // Trigger: "Get balloon", "Pop balloon", "Quest balloon"
                pattern: /\b(get( the)? balloon|pop( the)? balloon|take( the)? balloon)\b/i,
                action: () => this.dispatchGameEvent('REQ_COMPLETE_QUEST')
            }
        ];
    }

    /**
     * Parse natural language and execute the first matched intent.
     * @param {string} text The raw user input from the Logbook
     */
    processInput(text) {
        if (!text || typeof text !== 'string') return;
        
        const normalized = text.trim().toLowerCase();
        let matched = false;

        for (const intent of this.intents) {
            if (intent.pattern.test(normalized)) {
                console.log(`[LLMAssistant] Intent Matched: ${intent.pattern}`);
                intent.action();
                matched = true;
                break;
            }
        }

        if (!matched) {
            console.log(`[LLMAssistant] Unknown command: "${normalized}"`);
            this.showToast("The spirits do not understand that command...");
        }
    }

    /**
     * Dispatch an event to the global SacredGame.html and SacredGame.Panel.html bus
     * @param {string} type Event payload type
     * @param {object} payload Additional data
     */
    dispatchGameEvent(type, payload = {}) {
        // Broadcast to the parent iframe wrapper (SacredGame.Panel.html)
        // Which will cascade it or handle it directly
        const message = Object.assign({ type: type }, payload);
        
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, '*');
        } else {
            // Direct window dispatch for environments without the Panel wrapper
            window.postMessage(message, '*');
        }
    }
    
    /**
     * Show a transient 2D DOM toast notification for unrecognized commands
     */
    showToast(message) {
        // Use the existing panel HUD if available
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'SHOW_TOAST', message: message }, '*');
        } else {
            console.warn("LLM Toast:", message);
        }
    }
}

// Instantiate globally inside the iframe
window.LLMAssistantSystem = new LLMAssistant();

// Hook the existing Logbook caller to our new Assistant
// Component.Logbook.html calls window.parent.GameEngine.processInput
// We will intercept it here at the document head level if loaded alongside Logbook
if (typeof window.GameEngine === 'undefined') {
    window.GameEngine = {};
}
window.GameEngine.processInput = (text) => window.LLMAssistantSystem.processInput(text);
