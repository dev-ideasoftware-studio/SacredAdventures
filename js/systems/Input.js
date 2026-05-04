export class InputManager {
    constructor(engine) {
        this.engine = engine;
        this.keys = { w: false, a: false, s: false, d: false };
        this.touchStart = { x: 0, y: 0 };
    }

    init() {
        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
        this.setupMobileControls();
    }

    onKey(e, down) {
        // Prevent default scrolling for arrow keys and space
        if(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.code) > -1) {
            e.preventDefault();
        }

        const k = e.key.toLowerCase();
        if (k === 'w' || k === 'arrowup') this.keys.w = down;
        if (k === 's' || k === 'arrowdown') this.keys.s = down;
        if (k === 'a' || k === 'arrowleft') this.keys.a = down;
        if (k === 'd' || k === 'arrowright') this.keys.d = down;
        
        if (down && k === 'enter') {
            const input = document.getElementById('cmd-input');
            if (document.activeElement === input && input.value) {
                // Let the CommandInput component handle the actual processing via event listener or direct call
                // But generally we might want to dispatch an event or call engine
                // For now, let's assume CommandInput handles its own keydown or we trigger it here
            }
        }
    }

    setupMobileControls() {
        const up = document.querySelector('.ctrl-up');
        const down = document.querySelector('.ctrl-down');
        const left = document.querySelector('.ctrl-left');
        const right = document.querySelector('.ctrl-right');

        if (!up || !down || !left || !right) return;

        const handle = (key, val) => (e) => { 
            if(e.cancelable) e.preventDefault(); 
            this.keys[key] = val; 
        };
        
        up.addEventListener('touchstart', handle('w', true), {passive: false});
        up.addEventListener('touchend', handle('w', false));
        down.addEventListener('touchstart', handle('s', true), {passive: false});
        down.addEventListener('touchend', handle('s', false));
        left.addEventListener('touchstart', handle('a', true), {passive: false});
        left.addEventListener('touchend', handle('a', false));
        right.addEventListener('touchstart', handle('d', true), {passive: false});
        right.addEventListener('touchend', handle('d', false));
    }
}
