export class JournalInterface {
    constructor(engine) {
        this.engine = engine;
        this.iframe = document.getElementById('panel-frame');
        
        this.bindCommunications();
    }

    bindCommunications() {
        window.addEventListener('message', (e) => {
            if (e.data.type === 'USER_COMMAND') {
                this.processCommand(e.data.command.toLowerCase());
            }
            if (e.data.type === 'THUMB_MOVE') {
                window._thumbX = e.data.x || 0;
                window._thumbY = e.data.y || 0;
            }
            if (e.data.type === 'KEY_FORWARD') {
                // Bridge panel D-Pad directly to PlayerManager key events
                const event = new KeyboardEvent(e.data.eventType, { 
                    key: e.data.key,
                    bubbles: true,
                    cancelable: true
                });
                window.dispatchEvent(event);
            }
            if (e.data.type === 'JOURNAL_LOG') {
                // Post it down to the iframe (ResourceManager uses this)
                if (this.iframe && this.iframe.contentWindow) {
                     this.iframe.contentWindow.postMessage(e.data, '*');
                }
            }
        });
    }

    processCommand(cmd) {
        // WCAG friendly text driven gameplay logic
        if (cmd === 'help') {
            this.logToJournal("Available commands: 'look around', 'toggle view', 'get axe'");
        } else if (cmd === 'look around') {
            this.logToJournal("You see a wide open area. A forest of trees surrounds you.");
        } else if (cmd === 'toggle view') {
            this.engine.renderPipeline.toggleViewMode();
            this.engine.hexGridManager.setGridVisibility(this.engine.renderPipeline.isVillageView);
            this.logToJournal(`Swapped view to ${this.engine.renderPipeline.isVillageView ? "Top-Down Village Mode" : "First Person View"}.`);
        } else if (cmd === 'get axe') {
            this.engine.resourceManager.inventory.hasAxe = true;
            this.logToJournal("You picked up the stone axe. You can now chop trees.");
        } else {
            this.logToJournal(`I don't understand '${cmd}'. Type 'help'.`);
        }
    }

    logToJournal(text) {
        if (this.iframe && this.iframe.contentWindow) {
            this.iframe.contentWindow.postMessage({ type: 'JOURNAL_LOG', text: text }, '*');
        }
    }
}
