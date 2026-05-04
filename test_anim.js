const fs = require('fs');
// Very simple script to dump glTF structure if it's text, but glb is binary.
// Let's just strings it.
const { execSync } = require('child_process');
try {
  const result = execSync('strings Assets/Avatar2.glb | grep -i "name" -A 2 -B 2 | grep -v "Mesh" | grep -v "Material"').toString();
  console.log(result);
} catch(e) { console.error(e); }
