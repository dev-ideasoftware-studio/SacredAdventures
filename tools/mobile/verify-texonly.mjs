// Prove a texonly variant differs from its source ONLY in image bytes.
// Usage: node tools/mobile/verify-texonly.mjs <src.glb> <variant.glb>
import fs from "node:fs";
const read = (f) => { const b = fs.readFileSync(f); let o = 12, j, bin; while (o < b.length) { const l = b.readUInt32LE(o), t = b.readUInt32LE(o + 4), d = b.subarray(o + 8, o + 8 + l); if (t === 0x4e4f534a) j = JSON.parse(d); else if (t === 0x004e4942) bin = d; o += 8 + l; } return { j, bin }; };
const [a, b] = process.argv.slice(2).map(read);
const imgViews = new Set((a.j.images || []).map((i) => i.bufferView));
let same = 0, diffs = [];
for (let i = 0; i < a.j.bufferViews.length; i++) {
  if (imgViews.has(i)) continue;
  const va = a.j.bufferViews[i], vb = b.j.bufferViews[i];
  const ba = a.bin.subarray(va.byteOffset || 0, (va.byteOffset || 0) + va.byteLength), bb = b.bin.subarray(vb.byteOffset || 0, (vb.byteOffset || 0) + vb.byteLength);
  if (Buffer.compare(ba, bb) === 0) same++; else diffs.push(i);
}
const strip = (j) => { const c = structuredClone(j); for (const v of c.bufferViews) { delete v.byteOffset; delete v.byteLength; } delete c.buffers; return JSON.stringify(c); };
const jsonSame = strip(a.j) === strip(b.j);
console.log(JSON.stringify({ nonImageViewsIdentical: `${same}/${a.j.bufferViews.length - imgViews.size}`, differing: diffs, jsonIdenticalExceptOffsets: jsonSame }));
process.exit(diffs.length || !jsonSame ? 1 : 0);
