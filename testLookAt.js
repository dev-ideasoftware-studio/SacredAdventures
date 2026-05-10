const THREE = require('three');
const obj = new THREE.Object3D();
obj.lookAt(new THREE.Vector3(100, 0, 0)); // look at +X
console.log("Vector pointing along +X:");
console.log(new THREE.Vector3(0,0,1).applyQuaternion(obj.quaternion)); // Where does +Z point now?
console.log(new THREE.Vector3(0,0,-1).applyQuaternion(obj.quaternion)); // Where does -Z point now?
