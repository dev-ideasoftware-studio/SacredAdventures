export class StatsPanel {
    constructor(engine) {
        this.engine = engine;
        this.hpElem = document.getElementById('stat-hp');
        this.hungerElem = document.getElementById('stat-hunger');
        this.invElem = document.getElementById('stat-inv');
        this.cardsContainer = document.getElementById('cards-container');
    }

    update() {
        const p = this.engine.player;
        if(this.hpElem) this.hpElem.textContent = p.hp;
        if(this.hungerElem) {
            if(this.engine.hungerTriggered) {
                this.hungerElem.textContent = "Hungry";
                this.hungerElem.style.color = "#facc15";
            } else {
                this.hungerElem.textContent = "Satiated";
                this.hungerElem.style.color = "var(--sage-100)";
            }
        }
        if(this.invElem) {
            this.invElem.textContent = `🪵${p.wood} 🌽${p.corn} 🐟${p.fish}`;
        }
    }

    updateCards() {
        if(!this.cardsContainer) return;
        this.cardsContainer.innerHTML = '';
        this.engine.player.cards.forEach(card => {
            const div = document.createElement('div');
            div.className = 'card-item';
            div.textContent = '📦';
            div.onclick = () => {
                if(this.engine.onUseCard) this.engine.onUseCard(card);
            };
            div.title = "Fast Delivery: Summon Trader";
            this.cardsContainer.appendChild(div);
        });
    }
}
