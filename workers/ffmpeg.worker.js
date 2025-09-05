let ffmpeg = null;

self.onmessage = async function(e) {
    const { type } = e.data;
    
    switch(type) {
        case 'init':
            await initFFmpeg();
            break;
        case 'transcode':
            await transcodeWebMToMP4(e.data);
            break;
    }
};

async function initFFmpeg() {
    try {
        importScripts('../libs/ffmpeg.min.js');
        
        const { createFFmpeg, fetchFile } = FFmpeg;
        ffmpeg = createFFmpeg({
            log: false,
            progress: ({ ratio }) => {
                self.postMessage({ 
                    type: 'progress', 
                    progress: Math.round(ratio * 100) 
                });
            }
        });
        
        await ffmpeg.load();
        self.postMessage({ type: 'ready' });
        
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

async function transcodeWebMToMP4({ input, fps, quality, dimensions }) {
    try {
        const inputName = 'input.webm';
        const outputName = 'output.mp4';
        
        ffmpeg.FS('writeFile', inputName, new Uint8Array(input));
        
        // Quality-based CRF values (lower = higher quality, larger file)
        // Optimized for thumbnails - can use higher CRF for smaller files
        const crfValues = {
            'original': '20',  // Slightly higher CRF for better compression
            '720': '24',
            '480': '26',
            '320': '28'
        };
        const crf = crfValues[quality] || '24';
        
        // Build optimized ffmpeg command
        const args = [
            '-i', inputName,
            '-c:v', 'libx264',
            '-preset', 'veryslow',  // Better compression at cost of encoding time
            '-crf', crf,
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'baseline', // Better compatibility
            '-level', '3.0',
            '-movflags', '+faststart',
            '-x264opts', 'subme=6:me_range=15:rc_lookahead=25:keyint=250:min-keyint=25:bframes=3',
            '-an', // No audio
            '-r', String(Math.min(fps, 15)), // Cap frame rate for smaller files
            outputName
        ];
        
        await ffmpeg.run(...args);
        
        const data = ffmpeg.FS('readFile', outputName);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        
        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);
        
        self.postMessage({ type: 'complete', url });
        
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}