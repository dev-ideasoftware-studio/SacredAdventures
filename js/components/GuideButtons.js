export class GuideButtons {
    constructor(engine) {
        this.engine = engine;
        this.btnFire = document.getElementById('btn-fire');
        this.btnCraft = document.getElementById('btn-craft');
        this.btnCook = document.getElementById('btn-cook');
        this.campMenu = document.getElementById('camp-menu');
    }

    init() {
        // Setup global handlers for HTML onclick attributes if we keep that pattern, 
        // OR better, attach listeners here and remove onclick from HTML.
        // For refactoring speed, I'll attach window globals in main.js or here.
        // But ideal is clean separation.
    }

    updateCampButtons() {
        const p = this.engine.player;
        if(this.btnFire) this.btnFire.disabled = p.wood <= 0;
        if(this.btnCook) this.btnCook.disabled = !(this.engine.hasFire && p.corn > 0);
        if(this.btnCraft) this.btnCraft.disabled = p.wood <= 0 || p.hasSpear;
    }

    showCampMenu() {
        if(this.campMenu) this.campMenu.classList.remove('hidden');
    }

    hideCampMenu() {
        if(this.campMenu) this.campMenu.classList.add('hidden');
    }
}
