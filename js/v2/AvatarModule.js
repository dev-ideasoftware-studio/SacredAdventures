import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const ROT_OFFSET = -Math.PI / 2;
const TILE_SIZE = 1.5;

export const AvatarModule = {
  name: 'Avatar',

  _avatar: null,
  _mixer: null,
  _idleAction: null,
  _walkAction: null,
  _isWalking: false,
  _loaded: false,
  _tmpForward: new THREE.Vector3(),
  _tmpCamPos: new THREE.Vector3(),
  _tmpLook: new THREE.Vector3(),
  _tmpVel: new THREE.Vector3(),
  _tmpUp: new THREE.Vector3(0, 2.35, 0),
  _tmpLookUp: new THREE.Vector3(0, 0.75, 0),

  async load(scene, camera) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync('./Assets/Avatar3.glb');
    const avatar = gltf.scene;

    avatar.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    avatar.scale.set(0.969, 1.2155, 0.969);
    avatar.add(this._buildPlayerMarker());

    if (gltf.animations && gltf.animations.length > 0) {
      this._mixer = new THREE.AnimationMixer(avatar);
      const idleClip = gltf.animations.length > 7 ? gltf.animations[7] : gltf.animations[0];
      const walkClip = gltf.animations.length > 5 ? gltf.animations[5] : null;

      if (walkClip) this._stripRootXZ(walkClip);
      this._idleAction = this._mixer.clipAction(idleClip);
      this._idleAction.setEffectiveWeight(1).play();

      if (walkClip) {
        this._walkAction = this._mixer.clipAction(walkClip);
        this._walkAction.setEffectiveWeight(0).play();
      }
    }

    scene.add(avatar);
    this._avatar = avatar;
    this._loaded = true;
    this._lastX = null;
    this._lastZ = null;
    window._playerAvatar = avatar;
    console.log('%c[Avatar] ✅ Avatar3.glb loaded with marker + animation mixer', 'color:#a5d6a7;font-weight:bold;');
  },

  update(delta, _frameCount, _scene, camera) {
    if (!this._loaded || !this._avatar || !window.WorldPlayer) return;

    const player = window.WorldPlayer;
    const yaw = player.yaw;
    const groundY = window.WorldPhysics ? window.WorldPhysics.getGroundY(player.position.x, player.position.z) : player.position.y - 1.7;

    this._avatar.position.set(player.position.x, groundY, player.position.z);
    this._avatar.rotation.y = yaw + ROT_OFFSET;

    const speed = this._getPlayerSpeed(delta);
    const walking = player.grounded && speed > 0.08;
    this._setWalking(walking);
    if (this._mixer) this._mixer.update(delta);

    this._tmpForward.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    this._tmpCamPos.copy(this._avatar.position)
      .addScaledVector(this._tmpForward, -TILE_SIZE)
      .add(this._tmpUp);
    this._tmpLook.copy(this._avatar.position)
      .addScaledVector(this._tmpForward, 2.4)
      .add(this._tmpLookUp);

    camera.position.lerp(this._tmpCamPos, 1 - Math.pow(0.003, delta));
    camera.lookAt(this._tmpLook);
    camera.rotation.order = 'YXZ';

    window.WorldPlayer.avatar = this._avatar;
    window.WorldPlayer.speed = speed;
  },

  unload(scene) {
    if (this._avatar) scene.remove(this._avatar);
    if (this._mixer) this._mixer.stopAllAction();
    this._avatar = null;
    this._mixer = null;
    this._idleAction = null;
    this._walkAction = null;
    this._isWalking = false;
    this._loaded = false;
    this._lastX = null;
    this._lastZ = null;
    if (window._playerAvatar) window._playerAvatar = null;
    console.log('[Avatar] ⏹ Unloaded.');
  },

  _buildPlayerMarker() {
    const group = new THREE.Group();
    group.position.y = 0.02;
    group.rotation.y = Math.PI / 2;

    const radius = 0.375;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.02, 32),
      new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.2, metalness: 0.1 }),
    );
    base.position.y = 0.01;
    group.add(base);

    const border = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.02, 16, 48),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 }),
    );
    border.rotation.x = Math.PI / 2;
    border.position.y = 0.01;
    group.add(border);

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 }),
    );
    arrow.rotation.set(Math.PI / 2, 0, 0);
    arrow.scale.set(1, 1, 0.25);
    arrow.position.set(0, 0.01, radius + 0.1);
    group.add(arrow);

    return group;
  },

  _stripRootXZ(clip) {
    clip.tracks.forEach((track) => {
      if (!track.name.endsWith('.position')) return;
      const vals = track.values;
      if (vals.length < 3) return;
      const startX = vals[0];
      const startZ = vals[2];
      for (let i = 0; i < vals.length; i += 3) {
        vals[i] = startX;
        vals[i + 2] = startZ;
      }
    });
  },

  _setWalking(walking) {
    if (!this._idleAction || !this._walkAction || walking === this._isWalking) return;
    this._isWalking = walking;
    if (walking) {
      this._walkAction.reset().play();
      this._walkAction.crossFadeFrom(this._idleAction, 0.3, true);
    } else {
      this._idleAction.reset().play();
      this._idleAction.crossFadeFrom(this._walkAction, 0.3, true);
    }
  },

  _lastX: null,
  _lastZ: null,
  _getPlayerSpeed(delta) {
    const p = window.WorldPlayer.position;
    if (this._lastX === null) {
      this._lastX = p.x;
      this._lastZ = p.z;
      return 0;
    }
    const dx = p.x - this._lastX;
    const dz = p.z - this._lastZ;
    this._lastX = p.x;
    this._lastZ = p.z;
    return Math.sqrt(dx * dx + dz * dz) / Math.max(delta, 0.0001);
  },
};
