const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

const THREE = require('three');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader');
const fs = require('fs');

const loader = new GLTFLoader();
const data = fs.readFileSync('Assets/NPC.YB.glb');
const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

loader.parse(arrayBuffer, '', (gltf) => {
    console.log('Animations found:');
    gltf.animations.forEach((clip, idx) => {
        console.log(`${idx}: ${clip.name}`);
    });
    process.exit(0);
}, (err) => {
    console.error(err);
    process.exit(1);
});
