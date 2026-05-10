import * as THREE from "three";
import { V2_TILE_WORLD } from "./constants.js";

export const GRAVITY = -18.0;
export const PLAYER_HEIGHT = 1.7;
export const JUMP_IMPULSE = 7.0;
export const EPSILON = 0.08;
export const PLAYER_COLLISION_RADIUS = 0.55;

class PhysicsBody {
  constructor(position, eyeOffset = 0) {
    this.position = position;
    this.eyeOffset = eyeOffset;
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.mass = 1.0;
    this._normal = new THREE.Vector3(0, 1, 0);
  }

  _sampleNormal(getY) {
    const d = 0.4;
    const x = this.position.x;
    const z = this.position.z;
    const left = getY(x - d, z);
    const right = getY(x + d, z);
    const back = getY(x, z - d);
    const forward = getY(x, z + d);
    this._normal.set(left - right, 2 * d, back - forward).normalize();
  }

  step(delta, getY) {
    this._sampleNormal(getY);
    const groundY = getY(this.position.x, this.position.z) + this.eyeOffset;

    if (this.position.y > groundY + EPSILON) {
      this.velocity.y += GRAVITY * delta;
      this.grounded = false;
    } else {
      this.grounded = true;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.position.y = groundY;
      const slopeFactor = Math.max(0.6, this._normal.y);
      this.velocity.x *= Math.pow(slopeFactor, delta * 4);
      this.velocity.z *= Math.pow(slopeFactor, delta * 4);
    }

    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    const floor = getY(this.position.x, this.position.z) + this.eyeOffset;
    if (this.position.y < floor) {
      this.position.y = floor;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }
  }

  applyImpulse(vx, vy, vz) {
    this.velocity.x += vx;
    this.velocity.y += vy;
    this.velocity.z += vz;
  }
}

const _tmpColliderPos = new THREE.Vector3();

export const WorldPhysics = {
  _bodies: [],
  _colliders: [],
  _getY: null,

  _init(getY) {
    this._getY = getY;
    this._bodies = [];
    this._colliders = [];
  },

  _reset() {
    this._getY = null;
    this._bodies = [];
    this._colliders = [];
  },

  createBody(position, eyeOffset = 0) {
    const body = new PhysicsBody(position, eyeOffset);
    this._bodies.push(body);
    return body;
  },

  removeBody(body) {
    this._bodies = this._bodies.filter((b) => b !== body);
  },

  registerCollider({ id, x = 0, z = 0, radius = 1, object = null, passable = false, kind = "object" }) {
    const collider = {
      id: id || `collider.${this._colliders.length}`,
      x,
      z,
      radius,
      object,
      passable,
      kind,
    };
    this._colliders.push(collider);
    return collider;
  },

  removeCollider(collider) {
    this._colliders = this._colliders.filter((c) => c !== collider);
  },

  _colliderXZ(collider, out) {
    if (collider.object) {
      collider.object.getWorldPosition(out);
      return out;
    }
    return out.set(collider.x, 0, collider.z);
  },

  resolveBodyCollisions(body, bodyRadius = PLAYER_COLLISION_RADIUS) {
    if (!body || this._colliders.length === 0) return;
    const p = body.position;
    for (const collider of this._colliders) {
      if (collider.passable) continue;
      this._colliderXZ(collider, _tmpColliderPos);
      const dx = p.x - _tmpColliderPos.x;
      const dz = p.z - _tmpColliderPos.z;
      const minDist = bodyRadius + collider.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const push = minDist - d;
      p.x += (dx / d) * push;
      p.z += (dz / d) * push;
      body.velocity.x *= 0.25;
      body.velocity.z *= 0.25;
    }
    if (this._getY) p.y = Math.max(p.y, this._getY(p.x, p.z) + body.eyeOffset);
  },

  steerAroundObstacles(position, velocity, bodyRadius = PLAYER_COLLISION_RADIUS, lookAhead = V2_TILE_WORLD * 0.55) {
    const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
    if (speedSq < 0.0001 || this._colliders.length === 0) return velocity;
    const speed = Math.sqrt(speedSq);
    const fx = velocity.x / speed;
    const fz = velocity.z / speed;
    let avoidX = 0;
    let avoidZ = 0;
    for (const collider of this._colliders) {
      if (collider.passable) continue;
      this._colliderXZ(collider, _tmpColliderPos);
      const relX = _tmpColliderPos.x - position.x;
      const relZ = _tmpColliderPos.z - position.z;
      const forward = relX * fx + relZ * fz;
      if (forward <= 0 || forward > lookAhead + collider.radius) continue;
      const side = relX * -fz + relZ * fx;
      const clearance = bodyRadius + collider.radius + 0.35;
      if (Math.abs(side) > clearance) continue;
      const turnSign = side >= 0 ? -1 : 1;
      const strength = (1 - Math.abs(side) / clearance) * (1 - forward / (lookAhead + collider.radius));
      avoidX += -fz * turnSign * strength;
      avoidZ += fx * turnSign * strength;
    }
    if (avoidX || avoidZ) {
      velocity.x += avoidX * speed * 1.25;
      velocity.z += avoidZ * speed * 1.25;
      const nextSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) || 1;
      velocity.x = (velocity.x / nextSpeed) * speed;
      velocity.z = (velocity.z / nextSpeed) * speed;
    }
    return velocity;
  },

  stepAll(delta) {
    if (!this._getY) return;
    for (const body of this._bodies) body.step(delta, this._getY);
  },

  getGroundY(x, z) {
    return this._getY ? this._getY(x, z) : 0;
  },

  getGroundNormal(x, z, out = new THREE.Vector3()) {
    if (!this._getY) return out.set(0, 1, 0);
    const d = 0.5;
    const left = this._getY(x - d, z);
    const right = this._getY(x + d, z);
    const back = this._getY(x, z - d);
    const forward = this._getY(x, z + d);
    return out.set(left - right, 2 * d, back - forward).normalize();
  },

  isGrounded(position) {
    if (!this._getY) return true;
    return position.y <= this._getY(position.x, position.z) + EPSILON + 0.05;
  },

  getAnuPhysicsSnapshot() {
    return Object.freeze({
      schemaVersion: "1.0",
      gravityEnabled: true,
      elevationPhysicsEnabled: typeof this._getY === "function",
      movementAxes: Object.freeze(["x", "y", "z"]),
      terrainHeightSampling: typeof this._getY === "function",
      terrainNormalSampling: true,
      registeredBodyCount: this._bodies.length,
      registeredColliderCount: this._colliders.length,
      solidColliderCount: this._colliders.filter((collider) => !collider.passable).length,
      passableColliderCount: this._colliders.filter((collider) => collider.passable).length,
      gravity: GRAVITY,
      epsilon: EPSILON,
    });
  },
};
