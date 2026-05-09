export class System {
    constructor() {
        this.entities = [];
    }

    addEntity(entity) {
        if (!this.entities.includes(entity)) {
            this.entities.push(entity);
        }
    }

    removeEntity(entity) {
        this.entities = this.entities.filter(e => e !== entity);
    }

    update(deltaTime) {
        // To be implemented by subclasses
    }
}
