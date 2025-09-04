#!/bin/bash

# Create libs directory if it doesn't exist
mkdir -p libs

# Download FFmpeg.wasm files
echo "Downloading FFmpeg.wasm files..."

# Download files from unpkg
curl -L "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js" -o "libs/ffmpeg.min.js"
curl -L "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js" -o "libs/ffmpeg-core.js"
curl -L "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.wasm" -o "libs/ffmpeg-core.wasm"
curl -L "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.worker.js" -o "libs/ffmpeg-core.worker.js"

echo "FFmpeg.wasm files downloaded successfully!"
echo "You can now deploy the application with full MP4 export support."