export class Component {
    constructor() {
        this.entity = null; // Assigned when added to an Entity
    }

    // Called once a frame if a system manages it
    update(deltaTime) {}

    // Called when the component is removed or entity is destroyed
    destroy() {}
}
