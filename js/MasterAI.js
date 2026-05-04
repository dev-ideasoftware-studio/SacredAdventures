window.MasterAI = class MasterAI {
    constructor() {
        
        this.state = 'BOOTING';
    }

    /**
     * Takes over the root initialization sequence.
     * @param {Function} onReadyCallback - The legacy init sequence to trigger.
     */
    bootstrap(onReadyCallback) {
        
        
        if (document.readyState === 'complete') {
            this._start(onReadyCallback);
        } else {
            window.addEventListener('load', () => this._start(onReadyCallback));
        }
    }

    _start(onReadyCallback) {
        window.documentReady = true;
        
        if (onReadyCallback) onReadyCallback();
    }
}
