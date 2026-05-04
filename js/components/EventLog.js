export class EventLog {
    constructor() {
        this.element = document.getElementById('event-log');
    }

    log(msg, color) {
        if (!this.element) return;
        const div = document.createElement('div');
        div.textContent = msg;
        div.style.color = color || '#ccc';
        this.element.appendChild(div);
        this.element.scrollTop = this.element.scrollHeight;
    }

    clear() {
        if (this.element) this.element.innerHTML = '';
    }
}
