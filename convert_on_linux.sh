#!/bin/bash
# Run this script on your Linux machine with Docker installed
# This will convert the LAS file to Potree format

set -e

echo "============================================================"
echo "PotreeConverter for Linux"
echo "============================================================"
echo ""

# Check if LAS file exists
if [ ! -f "Cloud_1.las" ]; then
    echo "Error: Cloud_1.las not found"
    echo "Please copy the LAS file to this directory first"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker not installed"
    echo "Install with: sudo apt-get install docker.io"
    exit 1
fi

# Pull PotreeConverter image
echo "Pulling PotreeConverter Docker image..."
docker pull synth3d/potreeconverter

# Create output directory
mkdir -p KP_Giesing_Potree

# Run conversion
echo ""
echo "Converting LAS to Potree..."
echo "This may take 10-30 minutes for 82 million points..."
echo ""

docker run --rm \
    -v "$(pwd)":/data \
    synth3d/potreeconverter \
    PotreeConverter \
    -i /data/Cloud_1.las \
    -o /data/KP_Giesing_Potree \
    --output-attributes RGB \
    --overwrite

# Verify output
echo ""
echo "Verifying output..."
if [ -f "KP_Giesing_Potree/metadata.json" ]; then
    echo "✓ metadata.json created"
fi
if [ -f "KP_Giesing_Potree/octree.bin" ]; then
    echo "✓ octree.bin created"
fi
if [ -f "KP_Giesing_Potree/hierarchy.bin" ]; then
    echo "✓ hierarchy.bin created"
fi

echo ""
echo "============================================================"
echo "SUCCESS!"
echo "============================================================"
echo ""
echo "Copy the KP_Giesing_Potree directory back to your Mac:"
echo "  scp -r KP_Giesing_Potree user@mac-ip:/path/to/pointcloudviewer/"
echo ""
