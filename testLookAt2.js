const THREE = require('three');
const obj = new THREE.Object3D();
const horse = new THREE.Object3D();
horse.position.set(-4.0, 0, 5.0);
const yb = new THREE.Object3D();
yb.position.set(-2.0, 0, 2.4);

horse.lookAt(yb.position);
yb.lookAt(horse.position);

console.log("Horse +Z points to:", new THREE.Vector3(0,0,1).applyQuaternion(horse.quaternion));
console.log("Horse -Z points to:", new THREE.Vector3(0,0,-1).applyQuaternion(horse.quaternion));
console.log("Direction from Horse to YB:", new THREE.Vector3().subVectors(yb.position, horse.position).normalize());
console.log("Vector equality?", new THREE.Vector3(0,0,1).applyQuaternion(horse.quaternion).distanceTo(new THREE.Vector3().subVectors(yb.position, horse.position).normalize()));
