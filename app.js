(function() {
    'use strict';

    const state = {
        file: null,
        videoMeta: { duration: 0, width: 0, height: 0 },
        stills: [],
        selectedIds: [],
        settings: {
            frameSec: 3.0,
            transitionSec: 0.5,
            fade: true
        },
        preview: {
            ready: false,
            playing: false,
            fps: 12,
            maxHeight: 720
        },
        exportStatus: {
            webm: { state: 'idle', pct: 0, url: null },
            gif: { state: 'idle', pct: 0, url: null },
            mp4: { state: 'idle', pct: 0, url: null }
        }
    };

    let previewAnimationId = null;
    let previewStartTime = null;
    let currentPreviewTime = 0;
    let videoElement = null;
    let exportMediaRecorder = null;
    let exportWorkers = {};

    const elements = {
        fileInput: document.getElementById('file-input'),
        dropZone: document.getElementById('drop-zone'),
        stillsSection: document.getElementById('stills-section'),
        stillsGrid: document.getElementById('stills-grid'),
        settingsSection: document.getElementById('settings-section'),
        previewSection: document.getElementById('preview-section'),
        exportSection: document.getElementById('export-section'),
        selectionCount: document.getElementById('selection-count'),
        frameDuration: document.getElementById('frame-duration'),
        transitionDuration: document.getElementById('transition-duration'),
        totalDuration: document.getElementById('total-duration'),
        makeThumbnailBtn: document.getElementById('make-thumbnail-btn'),
        previewCanvas: document.getElementById('preview-canvas'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        restartBtn: document.getElementById('restart-btn'),
        previewStatus: document.getElementById('preview-status'),
        selectAllBtn: document.getElementById('select-all-btn'),
        clearBtn: document.getElementById('clear-btn'),
        invertBtn: document.getElementById('invert-btn')
    };

    function init() {
        setupEventListeners();
    }

    function setupEventListeners() {
        elements.fileInput.addEventListener('change', handleFileSelect);
        elements.dropZone.addEventListener('click', () => elements.fileInput.click());
        elements.dropZone.addEventListener('dragover', handleDragOver);
        elements.dropZone.addEventListener('dragleave', handleDragLeave);
        elements.dropZone.addEventListener('drop', handleDrop);

        elements.frameDuration.addEventListener('input', updateTotalDuration);
        elements.transitionDuration.addEventListener('input', updateTotalDuration);
        elements.makeThumbnailBtn.addEventListener('click', makeThumbnail);

        elements.selectAllBtn.addEventListener('click', selectAllStills);
        elements.clearBtn.addEventListener('click', clearSelection);
        elements.invertBtn.addEventListener('click', invertSelection);

        elements.playBtn.addEventListener('click', playPreview);
        elements.pauseBtn.addEventListener('click', pausePreview);
        elements.restartBtn.addEventListener('click', restartPreview);

        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', handleExport);
        });

        document.querySelectorAll('.cancel-btn').forEach(btn => {
            btn.addEventListener('click', handleCancelExport);
        });
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        elements.dropZone.classList.add('dragging');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        elements.dropZone.classList.remove('dragging');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        elements.dropZone.classList.remove('dragging');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('video/')) {
            processVideoFile(files[0]);
        }
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file && file.type.startsWith('video/')) {
            processVideoFile(file);
        }
    }

    async function processVideoFile(file) {
        state.file = file;
        resetState();
        
        try {
            await extractVideoMetadata(file);
            await extractStills();
            showStillsUI();
            showSettingsUI();
        } catch (error) {
            console.error('Error processing video:', error);
            alert('Error processing video. Please try another file.');
        }
    }

    function resetState() {
        state.stills = [];
        state.selectedIds = [];
        state.preview.ready = false;
        state.exportStatus = {
            webm: { state: 'idle', pct: 0, url: null },
            gif: { state: 'idle', pct: 0, url: null },
            mp4: { state: 'idle', pct: 0, url: null }
        };
        
        elements.stillsSection.classList.add('hidden');
        elements.settingsSection.classList.add('hidden');
        elements.previewSection.classList.add('hidden');
        elements.exportSection.classList.add('hidden');
        
        if (videoElement) {
            URL.revokeObjectURL(videoElement.src);
            videoElement = null;
        }
    }

    async function extractVideoMetadata(file) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.style.display = 'none';
            video.src = URL.createObjectURL(file);
            
            video.addEventListener('loadedmetadata', () => {
                state.videoMeta = {
                    duration: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight
                };
                videoElement = video;
                resolve();
            });
            
            video.addEventListener('error', reject);
            video.load();
        });
    }

    async function extractStills() {
        const { duration } = state.videoMeta;
        let numStills = 10;
        
        if (duration > 300) numStills = 20;
        if (duration > 600) numStills = 30;
        
        const timestamps = [];
        const padding = Math.min(0.5, duration * 0.05);
        const effectiveDuration = duration - 2 * padding;
        const interval = effectiveDuration / (numStills - 1);
        
        for (let i = 0; i < numStills; i++) {
            timestamps.push(padding + i * interval);
        }
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const thumbWidth = 150;
        const thumbHeight = 100;
        canvas.width = thumbWidth;
        canvas.height = thumbHeight;
        
        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const still = await captureFrame(videoElement, timestamp, canvas, ctx);
            still.id = `still-${i}`;
            state.stills.push(still);
        }
    }

    async function captureFrame(video, timestamp, canvas, ctx) {
        return new Promise((resolve) => {
            video.currentTime = timestamp;
            
            video.addEventListener('seeked', function onSeeked() {
                video.removeEventListener('seeked', onSeeked);
                
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const thumbURL = canvas.toDataURL('image/jpeg', 0.8);
                
                let bitmap = null;
                if (typeof createImageBitmap !== 'undefined') {
                    createImageBitmap(video).then(bmp => {
                        bitmap = bmp;
                        resolve({ tSec: timestamp, thumbURL, bitmap });
                    }).catch(() => {
                        resolve({ tSec: timestamp, thumbURL, bitmap: null });
                    });
                } else {
                    resolve({ tSec: timestamp, thumbURL, bitmap: null });
                }
            });
        });
    }

    function showStillsUI() {
        elements.stillsGrid.innerHTML = '';
        
        state.stills.forEach((still, index) => {
            const div = document.createElement('div');
            div.className = 'still-item selected';
            div.dataset.id = still.id;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `checkbox-${still.id}`;
            checkbox.checked = true;
            checkbox.addEventListener('change', handleStillSelection);
            
            const img = document.createElement('img');
            img.src = still.thumbURL;
            img.alt = `Frame at ${formatTime(still.tSec)}`;
            
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = formatTime(still.tSec);
            
            div.appendChild(checkbox);
            div.appendChild(img);
            div.appendChild(label);
            
            div.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    handleStillSelection.call(checkbox);
                }
            });
            
            elements.stillsGrid.appendChild(div);
            state.selectedIds.push(still.id);
        });
        
        updateSelectionCount();
        elements.stillsSection.classList.remove('hidden');
    }

    function showSettingsUI() {
        updateTotalDuration();
        elements.settingsSection.classList.remove('hidden');
    }

    function handleStillSelection() {
        const stillId = this.id.replace('checkbox-', '');
        const stillDiv = document.querySelector(`[data-id="${stillId}"]`);
        
        if (this.checked) {
            if (!state.selectedIds.includes(stillId)) {
                state.selectedIds.push(stillId);
            }
            stillDiv.classList.add('selected');
        } else {
            state.selectedIds = state.selectedIds.filter(id => id !== stillId);
            stillDiv.classList.remove('selected');
        }
        
        updateSelectionCount();
        updateTotalDuration();
    }

    function selectAllStills() {
        state.selectedIds = state.stills.map(s => s.id);
        document.querySelectorAll('.still-item input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
            cb.closest('.still-item').classList.add('selected');
        });
        updateSelectionCount();
        updateTotalDuration();
    }

    function clearSelection() {
        state.selectedIds = [];
        document.querySelectorAll('.still-item input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
            cb.closest('.still-item').classList.remove('selected');
        });
        updateSelectionCount();
        updateTotalDuration();
    }

    function invertSelection() {
        const newSelection = [];
        state.stills.forEach(still => {
            const checkbox = document.getElementById(`checkbox-${still.id}`);
            const stillDiv = document.querySelector(`[data-id="${still.id}"]`);
            
            if (state.selectedIds.includes(still.id)) {
                checkbox.checked = false;
                stillDiv.classList.remove('selected');
            } else {
                checkbox.checked = true;
                stillDiv.classList.add('selected');
                newSelection.push(still.id);
            }
        });
        state.selectedIds = newSelection;
        updateSelectionCount();
        updateTotalDuration();
    }

    function updateSelectionCount() {
        elements.selectionCount.textContent = `${state.selectedIds.length} selected`;
    }

    function updateTotalDuration() {
        const numSelected = state.selectedIds.length;
        state.settings.frameSec = parseFloat(elements.frameDuration.value);
        state.settings.transitionSec = parseFloat(elements.transitionDuration.value);
        
        if (state.settings.transitionSec > state.settings.frameSec * 0.8) {
            state.settings.transitionSec = state.settings.frameSec * 0.8;
            elements.transitionDuration.value = state.settings.transitionSec.toFixed(1);
        }
        
        const total = calculateTotalDuration(numSelected, state.settings.frameSec, state.settings.transitionSec);
        elements.totalDuration.textContent = `${total.toFixed(1)}s`;
    }

    function calculateTotalDuration(numFrames, frameSec, transitionSec) {
        if (numFrames <= 0) return 0;
        if (numFrames === 1) return frameSec;
        return numFrames * frameSec + (numFrames - 1) * transitionSec;
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async function makeThumbnail() {
        if (state.selectedIds.length === 0) {
            alert('Please select at least one frame');
            return;
        }
        
        state.preview.ready = true;
        setupPreviewCanvas();
        showPreviewUI();
        enableExportButtons();
    }

    function setupPreviewCanvas() {
        const { width, height } = state.videoMeta;
        const { maxHeight } = state.preview;
        
        let canvasWidth = width;
        let canvasHeight = height;
        
        if (height > maxHeight) {
            const scale = maxHeight / height;
            canvasWidth = Math.floor(width * scale);
            canvasHeight = maxHeight;
        }
        
        elements.previewCanvas.width = canvasWidth;
        elements.previewCanvas.height = canvasHeight;
    }

    function showPreviewUI() {
        elements.previewSection.classList.remove('hidden');
        elements.exportSection.classList.remove('hidden');
        updatePreviewStatus(0, 0);
    }

    function enableExportButtons() {
        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.disabled = false;
        });
    }

    function playPreview() {
        if (!state.preview.ready) return;
        
        state.preview.playing = true;
        elements.playBtn.classList.add('hidden');
        elements.pauseBtn.classList.remove('hidden');
        
        if (currentPreviewTime >= calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec)) {
            currentPreviewTime = 0;
        }
        
        previewStartTime = performance.now() - currentPreviewTime * 1000;
        renderPreviewFrame();
    }

    function pausePreview() {
        state.preview.playing = false;
        elements.playBtn.classList.remove('hidden');
        elements.pauseBtn.classList.add('hidden');
        
        if (previewAnimationId) {
            cancelAnimationFrame(previewAnimationId);
            previewAnimationId = null;
        }
    }

    function restartPreview() {
        pausePreview();
        currentPreviewTime = 0;
        renderSingleFrame(0);
        updatePreviewStatus(0, 0);
    }

    function renderPreviewFrame() {
        if (!state.preview.playing) return;
        
        const now = performance.now();
        currentPreviewTime = (now - previewStartTime) / 1000;
        
        const totalDuration = calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec);
        
        if (currentPreviewTime >= totalDuration) {
            currentPreviewTime = totalDuration;
            pausePreview();
            updatePreviewStatus(state.selectedIds.length, state.selectedIds.length);
            return;
        }
        
        const frameData = getFrameAtTime(currentPreviewTime);
        renderFrameData(frameData);
        updatePreviewStatus(frameData.currentIndex + 1, state.selectedIds.length);
        
        previewAnimationId = requestAnimationFrame(renderPreviewFrame);
    }

    function renderSingleFrame(time) {
        const frameData = getFrameAtTime(time);
        renderFrameData(frameData);
    }

    function getFrameAtTime(time) {
        const { frameSec, transitionSec } = state.settings;
        const segmentDuration = frameSec + transitionSec;
        
        let accumulatedTime = 0;
        for (let i = 0; i < state.selectedIds.length; i++) {
            const segmentEnd = accumulatedTime + frameSec;
            const transitionEnd = segmentEnd + (i < state.selectedIds.length - 1 ? transitionSec : 0);
            
            if (time <= segmentEnd) {
                return {
                    currentIndex: i,
                    nextIndex: -1,
                    alpha: 1.0
                };
            } else if (time <= transitionEnd && i < state.selectedIds.length - 1) {
                const progress = (time - segmentEnd) / transitionSec;
                return {
                    currentIndex: i,
                    nextIndex: i + 1,
                    alpha: 1 - progress
                };
            }
            
            accumulatedTime = transitionEnd;
        }
        
        return {
            currentIndex: state.selectedIds.length - 1,
            nextIndex: -1,
            alpha: 1.0
        };
    }

    function renderFrameData(frameData) {
        const ctx = elements.previewCanvas.getContext('2d');
        const canvas = elements.previewCanvas;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const currentStill = state.stills.find(s => s.id === state.selectedIds[frameData.currentIndex]);
        if (!currentStill) return;
        
        if (frameData.nextIndex === -1 || frameData.alpha === 1) {
            drawStill(ctx, currentStill, 1.0);
        } else {
            drawStill(ctx, currentStill, frameData.alpha);
            
            const nextStill = state.stills.find(s => s.id === state.selectedIds[frameData.nextIndex]);
            if (nextStill) {
                drawStill(ctx, nextStill, 1 - frameData.alpha);
            }
        }
    }

    function drawStill(ctx, still, alpha) {
        ctx.globalAlpha = alpha;
        
        if (still.bitmap) {
            ctx.drawImage(still.bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height);
        } else if (videoElement) {
            videoElement.currentTime = still.tSec;
            ctx.drawImage(videoElement, 0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        
        ctx.globalAlpha = 1.0;
    }

    function updatePreviewStatus(current, total) {
        const totalDuration = calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec);
        elements.previewStatus.textContent = `Frame ${current}/${total} • ${currentPreviewTime.toFixed(1)}s/${totalDuration.toFixed(1)}s`;
    }

    async function handleExport(e) {
        const format = e.target.closest('.export-item').dataset.format;
        
        if (state.exportStatus[format].state !== 'idle') return;
        
        showExportProgress(format, true);
        updateExportProgress(format, 0, 'Initializing...');
        
        try {
            switch(format) {
                case 'webm':
                    await exportWebM();
                    break;
                case 'gif':
                    await exportGIF();
                    break;
                case 'mp4':
                    await exportMP4();
                    break;
            }
        } catch (error) {
            console.error(`Export ${format} error:`, error);
            alert(`Failed to export ${format.toUpperCase()}: ${error.message}`);
            resetExportUI(format);
        }
    }

    function handleCancelExport(e) {
        const format = e.target.closest('.export-item').dataset.format;
        cancelExport(format);
    }

    function showExportProgress(format, show) {
        const item = document.querySelector(`[data-format="${format}"]`);
        const btn = item.querySelector('.export-btn');
        const progress = item.querySelector('.progress-container');
        const download = item.querySelector('.download-link');
        
        if (show) {
            btn.classList.add('hidden');
            progress.classList.remove('hidden');
            download.classList.add('hidden');
        } else {
            btn.classList.remove('hidden');
            progress.classList.add('hidden');
        }
    }

    function updateExportProgress(format, percent, label) {
        const item = document.querySelector(`[data-format="${format}"]`);
        const bar = item.querySelector('.progress-bar');
        const text = item.querySelector('.progress-label');
        
        bar.style.width = `${percent}%`;
        if (label) text.textContent = label;
    }

    function showDownloadLink(format, url, filename) {
        const item = document.querySelector(`[data-format="${format}"]`);
        const download = item.querySelector('.download-link');
        
        download.href = url;
        download.download = filename;
        download.textContent = `Download ${format.toUpperCase()}`;
        download.classList.remove('hidden');
    }

    function resetExportUI(format) {
        showExportProgress(format, false);
        state.exportStatus[format] = { state: 'idle', pct: 0, url: null };
    }

    function cancelExport(format) {
        state.exportStatus[format].state = 'cancelled';
        
        if (format === 'webm' && exportMediaRecorder) {
            exportMediaRecorder.stop();
            exportMediaRecorder = null;
        }
        
        if ((format === 'gif' || format === 'mp4') && exportWorkers[format]) {
            exportWorkers[format].terminate();
            delete exportWorkers[format];
        }
        
        resetExportUI(format);
    }

    async function exportWebM() {
        state.exportStatus.webm.state = 'encoding';
        
        const stream = elements.previewCanvas.captureStream(state.preview.fps);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
            ? 'video/webm;codecs=vp9' 
            : 'video/webm;codecs=vp8';
        
        const chunks = [];
        exportMediaRecorder = new MediaRecorder(stream, { mimeType });
        
        exportMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        
        exportMediaRecorder.onstop = () => {
            if (state.exportStatus.webm.state === 'cancelled') return;
            
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const filename = `thumb-${getTimestamp()}.webm`;
            
            state.exportStatus.webm.url = url;
            state.exportStatus.webm.state = 'complete';
            
            showDownloadLink('webm', url, filename);
            resetExportUI('webm');
        };
        
        const totalDuration = calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec);
        let exportTime = 0;
        
        exportMediaRecorder.start();
        updateExportProgress('webm', 0, 'Encoding...');
        
        const startTime = performance.now();
        
        function renderExportFrame() {
            if (state.exportStatus.webm.state === 'cancelled') {
                return;
            }
            
            const elapsed = (performance.now() - startTime) / 1000;
            exportTime = elapsed * (state.preview.fps / 1000) * 83.33;
            
            if (exportTime >= totalDuration) {
                exportMediaRecorder.stop();
                updateExportProgress('webm', 100, 'Finalizing...');
                return;
            }
            
            renderSingleFrame(exportTime);
            
            const progress = (exportTime / totalDuration) * 100;
            updateExportProgress('webm', progress, 'Encoding...');
            
            requestAnimationFrame(renderExportFrame);
        }
        
        renderExportFrame();
    }

    async function exportGIF() {
        state.exportStatus.gif.state = 'encoding';
        
        if (!exportWorkers.gif) {
            exportWorkers.gif = new Worker('workers/gif.worker.js');
        }
        
        const totalDuration = calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec);
        const frameCount = Math.ceil(totalDuration * state.preview.fps);
        const frameDuration = 1000 / state.preview.fps;
        
        const { width, height } = elements.previewCanvas;
        
        exportWorkers.gif.onmessage = (e) => {
            const { type, progress, url, error } = e.data;
            
            if (type === 'progress') {
                updateExportProgress('gif', progress, 'Encoding...');
            } else if (type === 'complete') {
                const filename = `thumb-${getTimestamp()}.gif`;
                state.exportStatus.gif.url = url;
                state.exportStatus.gif.state = 'complete';
                showDownloadLink('gif', url, filename);
                resetExportUI('gif');
            } else if (type === 'error') {
                throw new Error(error);
            }
        };
        
        exportWorkers.gif.postMessage({
            type: 'init',
            width,
            height,
            frameCount,
            frameDuration
        });
        
        for (let i = 0; i < frameCount; i++) {
            if (state.exportStatus.gif.state === 'cancelled') break;
            
            const time = (i / state.preview.fps);
            renderSingleFrame(time);
            
            const imageData = elements.previewCanvas.getContext('2d').getImageData(0, 0, width, height);
            
            exportWorkers.gif.postMessage({
                type: 'frame',
                frameIndex: i,
                imageData
            }, [imageData.data.buffer]);
        }
        
        if (state.exportStatus.gif.state !== 'cancelled') {
            exportWorkers.gif.postMessage({ type: 'finish' });
        }
    }

    async function exportMP4() {
        state.exportStatus.mp4.state = 'encoding';
        
        if (!state.exportStatus.webm.url) {
            updateExportProgress('mp4', 0, 'Creating WebM first...');
            await exportWebM();
            
            if (state.exportStatus.mp4.state === 'cancelled') return;
        }
        
        if (!exportWorkers.mp4) {
            exportWorkers.mp4 = new Worker('workers/ffmpeg.worker.js');
        }
        
        exportWorkers.mp4.onmessage = async (e) => {
            const { type, progress, url, error } = e.data;
            
            if (type === 'progress') {
                updateExportProgress('mp4', progress, 'Transcoding...');
            } else if (type === 'complete') {
                const filename = `thumb-${getTimestamp()}.mp4`;
                state.exportStatus.mp4.url = url;
                state.exportStatus.mp4.state = 'complete';
                showDownloadLink('mp4', url, filename);
                resetExportUI('mp4');
            } else if (type === 'error') {
                throw new Error(error);
            } else if (type === 'ready') {
                const response = await fetch(state.exportStatus.webm.url);
                const webmBlob = await response.blob();
                const buffer = await webmBlob.arrayBuffer();
                
                exportWorkers.mp4.postMessage({
                    type: 'transcode',
                    input: buffer,
                    fps: state.preview.fps
                }, [buffer]);
            }
        };
        
        updateExportProgress('mp4', 0, 'Loading encoder...');
        exportWorkers.mp4.postMessage({ type: 'init' });
    }

    function getTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        return `${year}${month}${day}-${hours}${minutes}${seconds}`;
    }

    init();
})();