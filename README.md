# Motion Thumbnail Maker

A browser-based animated thumbnail creator that processes videos entirely client-side.

## Setup Instructions

### 1. FFmpeg.wasm Files

For MP4 export functionality, you need to download the FFmpeg.wasm files:

1. Download the FFmpeg.wasm files from: https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/
   - `ffmpeg.min.js`
   - `ffmpeg-core.js`
   - `ffmpeg-core.wasm`
   - `ffmpeg-core.worker.js`

2. Place these files in the `libs/` directory

### 2. GIF Encoder Library (Optional)

The GIF worker includes a basic implementation. For better performance and smaller file sizes, you may want to use an external library:

- Option 1: Use `gif.js` from https://github.com/jnordberg/gif.js
- Option 2: Use `gifenc` from https://github.com/mattdesl/gifenc

If using an external library, update the import in `workers/gif.worker.js`.

## Usage

1. Open `index.html` in a modern web browser
2. Upload a video file by dragging and dropping or clicking to browse
3. Select the frames you want to include in your animated thumbnail
4. Adjust frame and transition durations
5. Click "Make Thumbnail" to preview
6. Export in your preferred format: WebM, GIF, or MP4

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Limited support (WebM export may not work)

## Features

- Client-side processing (videos never leave your device)
- Automatic frame extraction based on video duration
- Smooth fade transitions between frames
- Multiple export formats
- Responsive design

## Deployment to Netlify

### Quick Deploy

1. Push this repository to GitHub, GitLab, or Bitbucket
2. Connect your repository to Netlify
3. Deploy with default settings (no build command needed)

### Manual Deploy via CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy to Netlify
netlify deploy --prod --dir .
```

### Manual Deploy via Drag & Drop

1. Visit [Netlify Drop](https://app.netlify.com/drop)
2. Drag the entire project folder into the browser
3. Your site will be live immediately

### Important Notes for Deployment

- The `netlify.toml` file includes security headers and proper MIME type configurations
- CORS headers are set for the `libs/` directory to allow loading of external libraries
- The `_headers` file provides additional header configurations for specific file types
- WebAssembly files are served with appropriate headers for optimal performance

### Post-Deployment Setup

After deploying, remember to:
1. Add the FFmpeg.wasm files to the `libs/` directory if you haven't already
2. Test all export formats to ensure they work correctly in the deployed environment