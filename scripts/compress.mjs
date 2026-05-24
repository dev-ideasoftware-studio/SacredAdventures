import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Recursively find all GLB files in a directory
function getGlbFiles(dir, files = []) {
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      if (item !== 'node_modules' && item !== '.git') {
        getGlbFiles(itemPath, files);
      }
    } else if (item.endsWith('.glb')) {
      files.push(itemPath);
    }
  }
  return files;
}

async function main() {
  const assetsDir = path.join(__dirname, '../Assets');
  console.log('==================================================');
  console.log('⚡ Starting Sacred Adventures Asset Draco Compression ⚡');
  console.log('==================================================');
  
  console.log('🔄 Loading Draco modules...');
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const files = getGlbFiles(assetsDir);
  console.log(`📋 Found ${files.length} GLB files to process.`);
  console.log('--------------------------------------------------');

  for (const file of files) {
    const basename = path.basename(file);
    const relativePath = path.relative(assetsDir, file);
    console.log(`Processing: ${relativePath}...`);

    try {
      const origSize = fs.statSync(file).size;
      const document = await io.read(file);

      // Add the Draco compression extension
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

      // Overwrite the original file with the compressed document
      await io.write(file, document);

      const compSize = fs.statSync(file).size;
      const reduction = ((origSize - compSize) * 100 / origSize).toFixed(0);
      console.log(`  ✓ Compressed: ${(origSize/1024).toFixed(0)} KB → ${(compSize/1024).toFixed(0)} KB (Reduced by ${reduction}%)`);
    } catch (err) {
      console.error(`  ✗ Error compressing ${basename}:`, err.message);
    }
    console.log('--------------------------------------------------');
  }

  console.log('🎉 All assets compressed successfully!');
}

main().catch(err => {
  console.error('✗ General error:', err);
  process.exit(1);
});
