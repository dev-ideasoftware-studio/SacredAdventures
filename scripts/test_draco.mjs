import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const inputPath = path.join(__dirname, '../Assets/rabbit.animated.glb');
  const outputPath = path.join(__dirname, '../Assets/rabbit.animated.test.glb');

  console.log('🔄 Loading Draco modules...');
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  console.log('📖 Reading GLB file...');
  const document = await io.read(inputPath);

  console.log('⚡ Applying Draco mesh compression...');
  const dracoExtension = document.createExtension(KHRDracoMeshCompression);
  dracoExtension.setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizationVolume: 'bounds',
      quantizationBits: {
        POSITION: 14,
        TEXCOORD: 12,
        NORMAL: 10,
        COLOR: 8,
        GENERIC: 12,
      }
    });

  console.log('💾 Writing compressed GLB file...');
  await io.write(outputPath, document);

  const origSize = fs.statSync(inputPath).size;
  const compSize = fs.statSync(outputPath).size;
  console.log(`✓ Success!`);
  console.log(`  • Original: ${(origSize/1024).toFixed(1)} KB`);
  console.log(`  • Compressed: ${(compSize/1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('✗ Error during compression:', err);
  process.exit(1);
});
