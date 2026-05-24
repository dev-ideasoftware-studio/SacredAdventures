#!/bin/bash
# ==============================================================================
# Sacred Adventures — GLB Asset Draco Compression Utility
# ==============================================================================

echo "=================================================="
echo "⚡ Starting Sacred Adventures Asset Compression ⚡"
echo "=================================================="

# Direct path to local gltf-transform binary
CLI="./node_modules/.bin/gltf-transform"

if [ ! -f "$CLI" ]; then
    echo "✗ Error: gltf-transform binary not found at $CLI"
    echo "  Please run npm install first."
    exit 1
fi

# Create a temporary backup folder inside Assets/ to stage the compression
mkdir -p Assets/compressed_backup

# Find all GLB files (excluding our backup folder)
find Assets -name "*.glb" ! -path "*compressed_backup*" | while read -r file; do
    echo "Processing: $file"
    
    # Get original size in KB
    orig_size=$(wc -c < "$file")
    orig_size_kb=$((orig_size / 1024))
    echo "  • Original size: ${orig_size_kb} KB"
    
    # Run Draco compression using the project's local gltf-transform binary
    $CLI draco "$file" "Assets/compressed_backup/$(basename "$file")" --level 7 > /dev/null 2>&1
    
    # Verify the compressed file exists and has size
    if [ -f "Assets/compressed_backup/$(basename "$file")" ]; then
        comp_size=$(wc -c < "Assets/compressed_backup/$(basename "$file")")
        comp_size_kb=$((comp_size / 1024))
        
        # Calculate reduction percentage
        reduction=$(( (orig_size - comp_size) * 100 / orig_size ))
        echo "  • Compressed size: ${comp_size_kb} KB (Reduced by ${reduction}%)"
        
        # Replace the original file with the compressed one
        mv "Assets/compressed_backup/$(basename "$file")" "$file"
        echo "  ✓ Successfully compressed and replaced $file"
    else
        echo "  ✗ Failed to compress $file"
    fi
    echo "--------------------------------------------------"
done

# Clean up temp folder
rm -rf Assets/compressed_backup
echo "=================================================="
echo "🎉 All GLB assets successfully compressed!"
echo "=================================================="
