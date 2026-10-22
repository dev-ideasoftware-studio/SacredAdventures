// Texture-only mobile variant of a GLB.
//
// Rewrites ONLY the embedded images (resized to fit maxPx, same MIME type) and
// copies every other bufferView byte-for-byte, so geometry (incl. Draco
// streams), skins, animations, node names and materials stay bit-identical.
//
// Usage: node tools/mobile/texonly-variant.mjs <in.glb> <out.glb> <maxPx> [jpegQuality=92]
import fs from "node:fs";
import sharp from "sharp";

const [input, output, maxStr, qStr] = process.argv.slice(2);
const maxPx = Number(maxStr);
const jpegQuality = Number(qStr ?? 92);
if (!input || !output || !(maxPx > 0)) {
  console.error("usage: texonly-variant.mjs <in.glb> <out.glb> <maxPx> [jpegQuality]");
  process.exit(2);
}

const src = fs.readFileSync(input);
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
let off = 12, json = null, bin = null;
while (off < src.length) {
  const len = src.readUInt32LE(off), type = src.readUInt32LE(off + 4);
  const data = src.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
if (!json || !bin) throw new Error("GLB missing JSON or BIN chunk");
if ((json.buffers || []).length !== 1) throw new Error("expected exactly one buffer");

// Which bufferViews hold images?
const imageViews = new Map(); // bufferView index -> image
for (const img of json.images || []) if (img.bufferView !== undefined) imageViews.set(img.bufferView, img);

const report = [];
const parts = [];
let cursor = 0;
for (let i = 0; i < json.bufferViews.length; i++) {
  const bv = json.bufferViews[i];
  let bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const img = imageViews.get(i);
  if (img) {
    const meta = await sharp(bytes).metadata();
    const big = Math.max(meta.width, meta.height);
    if (big > maxPx) {
      let pipe = sharp(bytes).resize({ width: meta.width >= meta.height ? maxPx : undefined, height: meta.height > meta.width ? maxPx : undefined, kernel: "lanczos3" });
      if (img.mimeType === "image/jpeg") pipe = pipe.jpeg({ quality: jpegQuality, chromaSubsampling: "4:4:4", mozjpeg: true });
      else if (img.mimeType === "image/png") pipe = pipe.png({ compressionLevel: 9 });
      else throw new Error("unsupported image type " + img.mimeType);
      const out = await pipe.toBuffer();
      const m2 = await sharp(out).metadata();
      report.push({ image: img.name || i, from: `${meta.width}x${meta.height}`, to: `${m2.width}x${m2.height}`, mime: img.mimeType, kbBefore: Math.round(bytes.length / 1024), kbAfter: Math.round(out.length / 1024) });
      bytes = out;
    }
  }
  // 4-byte alignment for every view (glTF requires it for accessors)
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); cursor += pad; }
  bv.byteOffset = cursor;
  bv.byteLength = bytes.length;
  parts.push(Buffer.from(bytes));
  cursor += bytes.length;
}
const tailPad = (4 - (cursor % 4)) % 4;
if (tailPad) parts.push(Buffer.alloc(tailPad));
const newBin = Buffer.concat(parts);
json.buffers[0].byteLength = newBin.length;

let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
const jPad = (4 - (jsonBuf.length % 4)) % 4;
if (jPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jPad, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(output, Buffer.concat([header, jh, jsonBuf, bh, newBin]));

console.log(JSON.stringify({ input, output, maxPx, MBbefore: +(src.length / 1048576).toFixed(2), MBafter: +(fs.statSync(output).size / 1048576).toFixed(2), images: report }));
