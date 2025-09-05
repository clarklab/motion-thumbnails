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
            fade: true,
            quality: 'original'
        },
        preview: {
            ready: false,
            playing: false,
            looping: true,
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
        uploadCard: document.getElementById('upload-card'),
        mainEditorSection: document.getElementById('main-editor-section'),
        stillsGrid: document.getElementById('stills-grid'),
        selectionCount: document.getElementById('selection-count'),
        frameDuration: document.getElementById('frame-duration'),
        transitionDuration: document.getElementById('transition-duration'),
        frameDurationSlider: document.getElementById('frame-duration-slider'),
        transitionDurationSlider: document.getElementById('transition-duration-slider'),
        totalDuration: document.getElementById('total-duration'),
        previewCanvas: document.getElementById('preview-canvas'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        loopBtn: document.getElementById('loop-btn'),
        previewStatus: document.getElementById('preview-status'),
        selectAllBtn: document.getElementById('select-all-btn'),
        clearBtn: document.getElementById('clear-btn'),
        invertBtn: document.getElementById('invert-btn'),
        exportQuality: document.getElementById('export-quality'),
        newThumbBtn: document.getElementById('new-thumb-btn')
    };

    function init() {
        setupEventListeners();
        setupSliders();
    }

    function setupEventListeners() {
        // File upload listeners
        if (elements.fileInput) elements.fileInput.addEventListener('change', handleFileSelect);
        if (elements.dropZone) {
            elements.dropZone.addEventListener('click', () => elements.fileInput.click());
            elements.dropZone.addEventListener('dragover', handleDragOver);
            elements.dropZone.addEventListener('dragleave', handleDragLeave);
            elements.dropZone.addEventListener('drop', handleDrop);
        }

        // Settings listeners
        if (elements.frameDuration) elements.frameDuration.addEventListener('input', handleNumberInputChange);
        if (elements.transitionDuration) elements.transitionDuration.addEventListener('input', handleNumberInputChange);

        // Selection listeners
        if (elements.selectAllBtn) elements.selectAllBtn.addEventListener('click', selectAllStills);
        if (elements.clearBtn) elements.clearBtn.addEventListener('click', clearSelection);
        if (elements.invertBtn) elements.invertBtn.addEventListener('click', invertSelection);

        // Preview listeners
        if (elements.playBtn) elements.playBtn.addEventListener('click', playPreview);
        if (elements.pauseBtn) elements.pauseBtn.addEventListener('click', pausePreview);
        if (elements.loopBtn) elements.loopBtn.addEventListener('click', toggleLoop);

        // Export listeners - these exist in the initial HTML
        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', handleExport);
        });

        document.querySelectorAll('.cancel-btn').forEach(btn => {
            btn.addEventListener('click', handleCancelExport);
        });

        // Quality selector
        if (elements.exportQuality) {
            elements.exportQuality.addEventListener('change', (e) => {
                state.settings.quality = e.target.value;
            });
        }
        
        // New thumb button
        if (elements.newThumbBtn) {
            elements.newThumbBtn.addEventListener('click', handleNewThumb);
        }
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
            hideUploadCard();
            showStillsUI();
            showMainEditor();
            autoUpdatePreview();
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
        
        if (elements.mainEditorSection) elements.mainEditorSection.classList.add('hidden');
        
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
        
        // Randomly select 4 frames for initial preview
        const randomIndices = [];
        const numStills = state.stills.length;
        const numToSelect = Math.min(4, numStills);
        
        while (randomIndices.length < numToSelect) {
            const randomIdx = Math.floor(Math.random() * numStills);
            if (!randomIndices.includes(randomIdx)) {
                randomIndices.push(randomIdx);
            }
        }
        // Sort to maintain chronological order
        randomIndices.sort((a, b) => a - b);
        
        state.stills.forEach((still, index) => {
            const div = document.createElement('div');
            const isInitiallySelected = randomIndices.includes(index);
            div.className = `still-item${isInitiallySelected ? ' selected' : ''}`;
            div.dataset.id = still.id;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `checkbox-${still.id}`;
            checkbox.checked = isInitiallySelected;
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
            if (isInitiallySelected) {
                state.selectedIds.push(still.id);
            }
        });
        
        updateSelectionCount();
        updateTotalDuration();
    }

    function showMainEditor() {
        if (elements.mainEditorSection) elements.mainEditorSection.classList.remove('hidden');
    }

    function hideUploadCard() {
        if (elements.uploadCard) {
            elements.uploadCard.classList.add('hiding');
            setTimeout(() => {
                elements.uploadCard.classList.add('hidden');
            }, 400);
        }
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
        autoUpdatePreview();
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
        if (elements.selectionCount) {
            elements.selectionCount.textContent = `${state.selectedIds.length} selected`;
        }
    }

    function updateTotalDuration() {
        const numSelected = state.selectedIds.length;
        if (elements.frameDuration) state.settings.frameSec = parseFloat(elements.frameDuration.value);
        if (elements.transitionDuration) state.settings.transitionSec = parseFloat(elements.transitionDuration.value);
        
        if (state.settings.transitionSec > state.settings.frameSec * 0.8) {
            state.settings.transitionSec = state.settings.frameSec * 0.8;
            if (elements.transitionDuration) elements.transitionDuration.value = state.settings.transitionSec.toFixed(1);
        }
        
        const total = calculateTotalDuration(numSelected, state.settings.frameSec, state.settings.transitionSec);
        if (elements.totalDuration) elements.totalDuration.textContent = `${total.toFixed(1)}s`;
    }

    function calculateTotalDuration(numFrames, frameSec, transitionSec) {
        if (numFrames <= 0) return 0;
        if (numFrames === 1) return frameSec;
        
        // For seamless looping:
        // - All frames except the last get full duration
        // - Last frame gets half duration 
        // - Add transition back to first frame for seamless loop
        const lastFrameDuration = frameSec * 0.5;
        const normalFramesDuration = (numFrames - 1) * frameSec;
        const allTransitions = numFrames * transitionSec; // Including transition back to first
        
        return normalFramesDuration + lastFrameDuration + allTransitions;
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function handleNumberInputChange(e) {
        const sliderId = e.target.id + '-slider';
        const slider = document.getElementById(sliderId);
        if (slider) {
            updateSliderFromInput(slider, parseFloat(e.target.value));
        }
        handleSettingsChange();
    }
    
    function handleSettingsChange() {
        updateTotalDuration();
        if (state.selectedIds.length > 0) {
            autoUpdatePreview();
        }
    }

    function setupSliders() {
        if (elements.frameDurationSlider) {
            initializeSlider(elements.frameDurationSlider, elements.frameDuration);
        }
        if (elements.transitionDurationSlider) {
            initializeSlider(elements.transitionDurationSlider, elements.transitionDuration);
        }
    }

    function initializeSlider(sliderEl, inputEl) {
        const min = parseFloat(sliderEl.dataset.min);
        const max = parseFloat(sliderEl.dataset.max);
        const value = parseFloat(sliderEl.dataset.value);
        
        updateSliderVisual(sliderEl, value, min, max);
        
        let isDragging = false;
        
        function handlePointerDown(e) {
            isDragging = true;
            sliderEl.setPointerCapture(e.pointerId);
            updateSliderValue(e);
            e.preventDefault();
        }
        
        function handlePointerMove(e) {
            if (!isDragging) return;
            updateSliderValue(e);
        }
        
        function handlePointerUp(e) {
            if (!isDragging) return;
            isDragging = false;
            sliderEl.releasePointerCapture(e.pointerId);
        }
        
        function updateSliderValue(e) {
            const rect = sliderEl.getBoundingClientRect();
            const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const rawValue = min + (max - min) * percentage;
            const step = parseFloat(sliderEl.dataset.step) || 0.1;
            const value = Math.round(rawValue / step) * step;
            const clampedValue = Math.max(min, Math.min(max, value));
            
            updateSliderVisual(sliderEl, clampedValue, min, max);
            if (inputEl) {
                inputEl.value = clampedValue.toFixed(1);
                handleSettingsChange();
            }
        }
        
        // Mouse/Touch events
        sliderEl.addEventListener('pointerdown', handlePointerDown);
        sliderEl.addEventListener('pointermove', handlePointerMove);
        sliderEl.addEventListener('pointerup', handlePointerUp);
        
        // Keyboard events
        const thumb = sliderEl.querySelector('.slider-thumb');
        if (thumb) {
            thumb.addEventListener('keydown', (e) => {
                const step = parseFloat(sliderEl.dataset.step) || 0.1;
                let currentValue = parseFloat(inputEl.value);
                let newValue = currentValue;
                
                switch(e.key) {
                    case 'ArrowRight':
                    case 'ArrowUp':
                        newValue = Math.min(max, currentValue + step);
                        break;
                    case 'ArrowLeft':
                    case 'ArrowDown':
                        newValue = Math.max(min, currentValue - step);
                        break;
                    case 'Home':
                        newValue = min;
                        break;
                    case 'End':
                        newValue = max;
                        break;
                    default:
                        return;
                }
                
                e.preventDefault();
                updateSliderVisual(sliderEl, newValue, min, max);
                if (inputEl) {
                    inputEl.value = newValue.toFixed(1);
                    handleSettingsChange();
                }
            });
        }
    }

    function updateSliderFromInput(sliderEl, value) {
        const min = parseFloat(sliderEl.dataset.min);
        const max = parseFloat(sliderEl.dataset.max);
        updateSliderVisual(sliderEl, value, min, max);
    }

    function updateSliderVisual(sliderEl, value, min, max) {
        const percentage = ((value - min) / (max - min)) * 100;
        const range = sliderEl.querySelector('.slider-range');
        const thumb = sliderEl.querySelector('.slider-thumb');
        
        if (range) {
            range.style.width = `${percentage}%`;
        }
        if (thumb) {
            thumb.style.left = `${percentage}%`;
            thumb.setAttribute('aria-valuenow', value.toString());
        }
    }

    function autoUpdatePreview() {
        if (state.selectedIds.length === 0) return;
        
        state.preview.ready = true;
        setupPreviewCanvas();
        restartPreview();
        playPreview();
    }

    function setupPreviewCanvas() {
        if (!elements.previewCanvas) return;
        
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


    function playPreview() {
        if (!state.preview.ready) return;
        
        state.preview.playing = true;
        if (elements.playBtn) elements.playBtn.classList.add('hidden');
        if (elements.pauseBtn) elements.pauseBtn.classList.remove('hidden');
        
        if (currentPreviewTime >= calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec)) {
            currentPreviewTime = 0;
        }
        
        previewStartTime = performance.now() - currentPreviewTime * 1000;
        renderPreviewFrame();
    }

    function pausePreview() {
        state.preview.playing = false;
        if (elements.playBtn) elements.playBtn.classList.remove('hidden');
        if (elements.pauseBtn) elements.pauseBtn.classList.add('hidden');
        
        if (previewAnimationId) {
            cancelAnimationFrame(previewAnimationId);
            previewAnimationId = null;
        }
    }

    function toggleLoop() {
        state.preview.looping = !state.preview.looping;
        if (elements.loopBtn) {
            if (state.preview.looping) {
                elements.loopBtn.classList.add('active');
            } else {
                elements.loopBtn.classList.remove('active');
            }
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
            if (state.preview.looping) {
                currentPreviewTime = 0;
                previewStartTime = now;
            } else {
                currentPreviewTime = totalDuration;
                pausePreview();
                updatePreviewStatus(state.selectedIds.length, state.selectedIds.length);
                return;
            }
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
        const numFrames = state.selectedIds.length;
        
        if (numFrames <= 0) return { currentIndex: 0, nextIndex: -1, alpha: 1.0 };
        if (numFrames === 1) return { currentIndex: 0, nextIndex: -1, alpha: 1.0 };
        
        let accumulatedTime = 0;
        
        // Handle all frames except the last one (normal duration)
        for (let i = 0; i < numFrames - 1; i++) {
            const frameEnd = accumulatedTime + frameSec;
            const transitionEnd = frameEnd + transitionSec;
            
            if (time <= frameEnd) {
                return {
                    currentIndex: i,
                    nextIndex: -1,
                    alpha: 1.0
                };
            } else if (time <= transitionEnd) {
                const progress = (time - frameEnd) / transitionSec;
                return {
                    currentIndex: i,
                    nextIndex: i + 1,
                    alpha: 1 - progress
                };
            }
            
            accumulatedTime = transitionEnd;
        }
        
        // Handle the last frame (shorter duration)
        const lastFrameIndex = numFrames - 1;
        const lastFrameDuration = frameSec * 0.5;
        const lastFrameEnd = accumulatedTime + lastFrameDuration;
        const finalTransitionEnd = lastFrameEnd + transitionSec;
        
        if (time <= lastFrameEnd) {
            return {
                currentIndex: lastFrameIndex,
                nextIndex: -1,
                alpha: 1.0
            };
        } else if (time <= finalTransitionEnd) {
            // Fade from last frame back to first frame for seamless loop
            const progress = (time - lastFrameEnd) / transitionSec;
            return {
                currentIndex: lastFrameIndex,
                nextIndex: 0, // Fade to first frame
                alpha: 1 - progress
            };
        }
        
        // Should not reach here, but fallback to first frame
        return {
            currentIndex: 0,
            nextIndex: -1,
            alpha: 1.0
        };
    }

    function renderFrameData(frameData) {
        if (!elements.previewCanvas) return;
        
        const ctx = elements.previewCanvas.getContext('2d');
        const canvas = elements.previewCanvas;
        
        renderFrameDataToCanvas(frameData, ctx, canvas);
    }
    
    function renderFrameDataToCanvas(frameData, ctx, canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const currentStill = state.stills.find(s => s.id === state.selectedIds[frameData.currentIndex]);
        if (!currentStill) return;
        
        if (frameData.nextIndex === -1 || frameData.alpha === 1) {
            drawStillToCanvas(ctx, currentStill, 1.0, canvas);
        } else {
            drawStillToCanvas(ctx, currentStill, frameData.alpha, canvas);
            
            const nextStill = state.stills.find(s => s.id === state.selectedIds[frameData.nextIndex]);
            if (nextStill) {
                drawStillToCanvas(ctx, nextStill, 1 - frameData.alpha, canvas);
            }
        }
    }

    function drawStill(ctx, still, alpha) {
        drawStillToCanvas(ctx, still, alpha, ctx.canvas);
    }
    
    function drawStillToCanvas(ctx, still, alpha, canvas) {
        ctx.globalAlpha = alpha;
        
        // Enable high-quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        if (still.bitmap) {
            ctx.drawImage(still.bitmap, 0, 0, canvas.width, canvas.height);
        } else if (videoElement) {
            videoElement.currentTime = still.tSec;
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        }
        
        ctx.globalAlpha = 1.0;
    }

    function updatePreviewStatus(current, total) {
        if (elements.previewStatus) {
            const totalDuration = calculateTotalDuration(state.selectedIds.length, state.settings.frameSec, state.settings.transitionSec);
            elements.previewStatus.textContent = `Frame ${current}/${total} • ${currentPreviewTime.toFixed(1)}s/${totalDuration.toFixed(1)}s`;
        }
    }

    async function handleExport(e) {
        const format = e.target.closest('.export-item').dataset.format;
        
        if (!state.preview.ready) {
            alert('Please select at least one frame first');
            return;
        }
        
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
        const format = e.target.dataset.format;
        cancelExport(format);
    }

    function showExportProgress(format, show) {
        const progressEl = document.getElementById(`export-progress-${format}`);
        const item = document.querySelector(`[data-format="${format}"]`);
        const btn = item?.querySelector('.export-btn');
        const download = item?.querySelector('.download-link');
        
        if (show) {
            if (btn) btn.disabled = true;
            if (progressEl) {
                progressEl.classList.remove('hidden');
            }
            if (download) download.classList.add('hidden');
        } else {
            if (btn) btn.disabled = false;
            if (progressEl) {
                progressEl.classList.add('hidden');
            }
        }
    }

    function updateExportProgress(format, percent, label) {
        const progressEl = document.getElementById(`export-progress-${format}`);
        if (!progressEl) return;
        
        const bar = progressEl.querySelector('.progress-overlay-fill');
        const text = progressEl.querySelector('.progress-overlay-label');
        
        if (bar) bar.style.width = `${percent}%`;
        if (label && text) text.textContent = `${format.toUpperCase()}: ${label}`;
    }

    function showDownloadLink(format, url, filename) {
        const item = document.querySelector(`[data-format="${format}"]`);
        const download = item?.querySelector('.download-link');
        
        if (download) {
            download.href = url;
            download.download = filename;
            download.textContent = `Download ${format.toUpperCase()}`;
            download.classList.remove('hidden');
        }
        
        // Auto-download the file
        autoDownload(url, filename);
    }
    
    function autoDownload(url, filename) {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
        
        // Create export canvas with quality-based dimensions
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        const { width: exportWidth, height: exportHeight } = getExportDimensions();
        exportCanvas.width = exportWidth;
        exportCanvas.height = exportHeight;
        
        // Optimize frame rate based on content - thumbnails don't need high fps
        const optimizedFps = Math.min(state.preview.fps, 15); // Cap at 15fps for smaller files
        const stream = exportCanvas.captureStream(optimizedFps);
        
        // Use VP9 for better compression, fall back to VP8
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
            ? 'video/webm;codecs=vp9' 
            : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : 'video/webm';
        
        // Optimize bitrate based on quality setting and content
        const pixelCount = exportWidth * exportHeight;
        
        // Calculate optimal bitrate based on resolution and motion content
        // For thumbnails, we can use lower bitrates since they're short loops
        const baseBitrate = Math.max(200000, pixelCount * 0.15); // Minimum 200kbps, scale with resolution
        
        const qualityMultipliers = {
            'original': 1.0,
            '720': 0.8,
            '480': 0.6,
            '320': 0.4
        };
        
        const videoBitsPerSecond = Math.round(baseBitrate * (qualityMultipliers[state.settings.quality] || 1.0));
        
        const chunks = [];
        exportMediaRecorder = new MediaRecorder(stream, { 
            mimeType,
            videoBitsPerSecond 
        });
        
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
            exportTime = elapsed * (optimizedFps / 1000) * 83.33;
            
            if (exportTime >= totalDuration) {
                exportMediaRecorder.stop();
                updateExportProgress('webm', 100, 'Finalizing...');
                return;
            }
            
            // Render to export canvas at target quality
            const frameData = getFrameAtTime(exportTime);
            renderFrameDataToCanvas(frameData, exportCtx, exportCanvas);
            
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
        // Optimize frame rate for GIFs - lower fps = smaller files, but maintain smoothness
        const optimizedFps = Math.min(state.preview.fps, 12); // Cap at 12fps for GIFs
        const frameCount = Math.ceil(totalDuration * optimizedFps);
        const frameDuration = 1000 / optimizedFps;
        
        // Create export canvas with quality-based dimensions
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        const { width: exportWidth, height: exportHeight } = getExportDimensions();
        exportCanvas.width = exportWidth;
        exportCanvas.height = exportHeight;
        
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
            width: exportWidth,
            height: exportHeight,
            frameCount,
            frameDuration
        });
        
        for (let i = 0; i < frameCount; i++) {
            if (state.exportStatus.gif.state === 'cancelled') break;
            
            // Render to export canvas at target quality
            const time = (i / optimizedFps);
            const frameData = getFrameAtTime(time);
            renderFrameDataToCanvas(frameData, exportCtx, exportCanvas);
            
            const imageData = exportCtx.getImageData(0, 0, exportWidth, exportHeight);
            
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
                    fps: state.preview.fps,
                    quality: state.settings.quality,
                    dimensions: getExportDimensions()
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
    
    function handleNewThumb() {
        const confirmed = confirm('Are you REALLY sure? This will refresh the page and you\'ll lose your current work.');
        if (confirmed) {
            window.location.reload();
        }
    }

    function getExportDimensions() {
        const quality = state.settings.quality;
        const { width: originalWidth, height: originalHeight } = state.videoMeta;
        
        if (quality === 'original') {
            return { width: originalWidth, height: originalHeight };
        }
        
        const targetHeight = parseInt(quality);
        const aspectRatio = originalWidth / originalHeight;
        
        // Calculate new dimensions maintaining aspect ratio
        let newHeight = Math.min(targetHeight, originalHeight);
        let newWidth = Math.round(newHeight * aspectRatio);
        
        // Ensure dimensions are even for video encoding
        newWidth = newWidth % 2 === 0 ? newWidth : newWidth + 1;
        newHeight = newHeight % 2 === 0 ? newHeight : newHeight + 1;
        
        return { width: newWidth, height: newHeight };
    }

    init();
})();