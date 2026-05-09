// A highly decoupled Publisher/Subscriber pattern for the Sacred Engine Event Bus
export class EventBus {
    constructor() {
        this.listeners = {};
    }

    subscribe(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);

        return () => {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        };
    }

    dispatch(event, payload = {}) {
        if (this.listeners[event]) {
            // Use snapshot of current listeners to prevent errors if modifications happen during loop
            const listeners = [...this.listeners[event]];
            listeners.forEach(callback => {
                try {
                    callback(payload);
                } catch (e) {
                    console.error(`[EventBus] Error in listener for event ${event}:`, e);
                }
            });
        }
    }

    clear() {
        this.listeners = {};
    }
}

// Global singleton instance for the entire engine
export const Bus = new EventBus();
