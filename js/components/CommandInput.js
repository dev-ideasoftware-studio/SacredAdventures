export class CommandInput {
    constructor(engine) {
        this.engine = engine;
        this.input = document.getElementById('cmd-input');
    }

    init() {
        if(!this.input) return;
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.input.value) {
                this.processCommand(this.input.value);
                this.input.value = '';
                e.preventDefault();
            }
        });
    }

    processCommand(cmd) {
        // Simple echo for now, can expand to more complex parsing
        if(this.engine.onCommand) {
            this.engine.onCommand(cmd);
        } else {
            console.log("Command:", cmd);
        }
    }
}
