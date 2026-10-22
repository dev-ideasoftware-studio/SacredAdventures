import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder': await draco3d.createDecoderModule()});
function dims(buf){ if(buf[0]===0x89) return [buf.readUInt32BE(16),buf.readUInt32BE(20)];
  if(buf[0]===0xff){let i=2;while(i<buf.length){const m=buf[i+1];const l=buf.readUInt16BE(i+2);if(m>=0xc0&&m<=0xc3)return[buf.readUInt16BE(i+7),buf.readUInt16BE(i+5)];i+=2+l;}}
  if(buf.slice(0,4).toString()==='RIFF'&&buf.slice(12,16).toString()==='VP8X') return [1+buf.readUIntLE(24,3),1+buf.readUIntLE(27,3)];
  return [0,0]; }
const out={};
for (const f of process.argv.slice(3)) {
  try{ const doc=await io.read(f); const r=doc.getRoot(); let tris=0;
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()){const i=p.getIndices();tris+=(i?i.getCount():p.getAttribute('POSITION').getCount())/3;}
  const tex=r.listTextures().map(t=>dims(Buffer.from(t.getImage())));
  out[f]={tris:Math.round(tris),prims:r.listMeshes().reduce((a,m)=>a+m.listPrimitives().length,0),materials:r.listMaterials().length,skinned:r.listSkins().length>0,animations:r.listAnimations().length,
   textures:tex.length,maxTex:Math.max(0,...tex.map(d=>Math.max(...d))),vramMB:+(tex.reduce((a,d)=>a+d[0]*d[1]*4*1.333,0)/1048576).toFixed(1),
   draco:r.listExtensionsUsed().some(e=>e.extensionName==='KHR_draco_mesh_compression'),fileMB:+(fs.statSync(f).size/1048576).toFixed(2)};
  }catch(e){out[f]={error:String(e).slice(0,120)}}
}
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));
