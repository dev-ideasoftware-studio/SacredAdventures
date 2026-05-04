import * as THREE from 'three';

export class Entity {
    constructor(id, name = 'UnnamedEntity') {
        this.id = id || THREE.MathUtils.generateUUID();
        this.name = name;
        this.components = new Map();
        this.isActive = true;
    }

    addComponent(component) {
        this.components.set(component.constructor.name, component);
        component.entity = this;
        return this;
    }

    getComponent(componentClass) {
        return this.components.get(componentClass.name);
    }

    hasComponent(componentClass) {
        return this.components.has(componentClass.name);
    }

    removeComponent(componentClass) {
        const component = this.components.get(componentClass.name);
        if (component) {
            component.destroy();
            this.components.delete(componentClass.name);
        }
    }

    destroy() {
        this.components.forEach(component => component.destroy());
        this.components.clear();
        this.isActive = false;
    }
}
