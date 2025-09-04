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

async function transcodeWebMToMP4({ input, fps }) {
    try {
        const inputName = 'input.webm';
        const outputName = 'output.mp4';
        
        ffmpeg.FS('writeFile', inputName, new Uint8Array(input));
        
        await ffmpeg.run(
            '-i', inputName,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-an',
            '-r', String(fps),
            outputName
        );
        
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