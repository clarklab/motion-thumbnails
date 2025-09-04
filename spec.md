Motion Thumbnail spec

# SIMPLE Animated Thumbnail Maker — Spec (Vanilla JS, per-format on-demand export)

## 1) Goal & Scope

A static, client-only web app. User drops in a webinar video, picks stills, sets simple timing, clicks **Make Thumbnail** to generate a playable **preview**, then chooses **exactly which format(s)** to export—**WebM**, **GIF**, or **MP4**—via **separate buttons**. No servers. No frameworks.

## 2) Outputs (on-demand only)

* **Preview (in-page)**: `<canvas>` slideshow with fades using chosen stills/timings.
* **Exports (user-initiated, per button)**:

  * **WebM**: via `canvas.captureStream()` + `MediaRecorder`.
  * **GIF**: via small JS GIF encoder in a **Web Worker**.
  * **MP4 (H.264)**: via **ffmpeg.wasm** in a **Web Worker** (transcode from WebM or from per-frame PNGs).

> Nothing is encoded until the user clicks that specific **Export** button. If the user hasn’t run **Make Thumbnail**, exports are disabled.

## 3) UI/UX (vanilla HTML/CSS)

* **Header**: App name + one-line “browser-only” note.
* **Upload Card**:

  * Drag/drop area + “Choose file” button (`<input type="file" accept="video/*">`).
  * Tiny note: “Your video never leaves your device.”
* **Stills Grid** (appears after analysis):

  * Evenly sampled stills (see §4).
  * Each still: thumbnail image, timestamp label, **checkbox** (checked by default).
  * Toolbar: **Select All**, **Clear**, **Invert Selection**, selected count.
* **Settings (simple only)**:

  * **Frame duration (seconds)** — default **3.0**, step 0.1, min 0.2, max 10.
  * **Transition duration (seconds)** — default **0.5**, step 0.1, min 0, max 2.
  * **Transition type** — fixed **Fade** (read-only text).
  * **Computed total time** (read-only): `N*frame + (N-1)*transition`.
* **Make Thumbnail** button:

  * Validates selections, preps preview timeline, enables export buttons.
* **Preview Card**:

  * `<canvas>` showing the slideshow (Play / Pause / Restart).
  * Status line (current still index / total, elapsed / total duration).
* **Export Card**:

  * Three **separate buttons**: **Export WebM**, **Export GIF**, **Export MP4**.
  * Each shows a progress bar + phase label (Initializing / Encoding / Finalizing).
  * Each yields a **Download** link on completion.
  * **Cancel** per export.

> Style: clean, stark black-and-white (CSS variables), clear focus rings, high contrast.

## 4) Still Extraction Rules

* Always generate **at least 10** stills.
* **20** stills if video **> 5 min**.
* **30** stills if video **> 10 min**.
* Evenly spaced across duration, skipping the first/last \~0.5s when possible.
* Implementation:

  1. Create hidden `<video>` with `URL.createObjectURL(file)`.
  2. Wait for `loadedmetadata` → read `duration`.
  3. Compute timestamps.
  4. For each timestamp: set `video.currentTime = t`, wait `seeked`, draw to offscreen `<canvas>`; store:

     * **thumbnail** (scaled, dataURL) for grid display
     * **ImageBitmap** (if supported) or full-res draw callback for preview/export.

## 5) State Model (minimal)

```
state = {
  file, videoMeta: { duration, width, height },
  stills: [ { id, tSec, thumbURL, bitmap? } ],
  selectedIds: [...],           // order preserved
  settings: {
    frameSec: 3.0,
    transitionSec: 0.5,
    fade: true                  // fixed
  },
  preview: {
    ready: false,
    playing: false,
    fps: 12,                    // internal; constant
    maxHeight: 720              // internal; constant
  },
  exportStatus: {
    webm: { state, pct, url? },
    gif:  { state, pct, url? },
    mp4:  { state, pct, url? }
  }
}
```

## 6) Preview Timeline (Canvas)

* **Single `<canvas>`** sized to maintain source aspect ratio, clamped by `maxHeight` (e.g., 720px).
* **Playback model** (for preview and for deterministic exports):

  * With `N` selected stills:

    * Show still `i` for `frameSec`.
    * Crossfade to still `i+1` over `transitionSec` (linear alpha).
  * Total duration = `N*frameSec + (N-1)*transitionSec`.
* **Render loop**: `requestAnimationFrame` with time accumulator targeting \~12 fps (don’t set styles; keep vanilla).
* **Crossfade**:

  * Draw still A with alpha `(1 - p)`; draw still B with alpha `p`, where `p ∈ [0,1]` across `transitionSec`.
  * For **transitionSec=0**, it’s effectively a cut (still fade param remains “Fade” but becomes instantaneous).

## 7) Export Triggers (per-format)

### Guard

* Export buttons are **disabled** until **Make Thumbnail** has run (ensures timeline is valid).
* On click, snapshot the current **selection + settings** (immutably) to guarantee deterministic export.

### A) WebM Export (native, fastest)

* Start a dedicated render pass for exactly `totalDuration`.
* `stream = canvas.captureStream(fps)` where `fps = 12`.
* `rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })` (fallback to vp8 if needed).
* Collect chunks → `Blob('video/webm')` → object URL.
* Progress: since `MediaRecorder` doesn’t give pct, estimate via elapsed / totalDuration; show phase labels.

### B) GIF Export (Worker)

* Worker receives:

  * width/height, fps, `frameCount = ceil(totalDuration*fps)`
  * For each frame index, main thread provides `ImageData` (or PNG blob) **pulled from the same deterministic render pass** (don’t rely on real-time).
* Encoder: choose a small, well-maintained JS lib (e.g., gifenc/omggif-based).
* Output: Blob('image/gif') → object URL.
* Progress: percentage of frames encoded.

### C) MP4 Export (Worker, ffmpeg.wasm)

* Option 1 (preferred for perf): feed the completed **WebM** as input and transcode to MP4.
* Option 2: feed a sequence of PNG frames (larger memory cost).
* ffmpeg command (example intent): H.264, 12 fps, medium CRF, no audio.
* Progress: parse ffmpeg logs to estimate pct (frames processed / total frames).

> Concurrency: allow running any format independently. If both WebM and MP4 are requested, suggest **make WebM first** (UI hint), then MP4 can transcode from it (faster and smaller memory footprint).

## 8) File Structure (no build tools required)

```
/index.html         // all UI, sections, and buttons
/styles.css         // monochrome theme, layout
/app.js             // all logic (modular IIFE or ES modules if desired)
/workers/
  gif.worker.js
  ffmpeg.worker.js
/libs/
  ffmpeg.wasm files (lazily loaded only when MP4 export starts)
  gif-encoder.umd.js (imported by gif.worker.js)
```

* Keep everything ES5/ES6 compatible; no bundlers required.
* Lazy-load workers/libs on first use to reduce initial load.

## 9) Accessibility

* All interactive elements keyboard reachable.
* Checkboxes labeled with thumbnail index and timestamp.
* Canvas preview has Play/Pause buttons with aria-labels.
* Progress areas use `aria-live="polite"`.

## 10) Validation & Edge Cases

* **Selections**: Require at least 1 still. If only 1, there are 0 transitions; total time = `frameSec`.
* **Transition > Frame**: clamp transition to `min(transitionSec, frameSec * 0.8)` and show a small warning.
* **Short videos**: seeking may clamp near edges; if fewer than requested frames can be sampled, fill from nearest valid times and show a note.
* **Safari/Old browsers**: if `MediaRecorder` lacks WebM, disable WebM export with a tooltip; GIF/MP4 still available.
* **Cancel**: stop recorder/worker; free memory; UI returns to ready state.

## 11) Performance & Memory

* Use **ImageBitmap** for stills where available.
* Revoke all object URLs when no longer needed.
* Cap canvas height to **720px**.
* Prefer **WebM → MP4** transcode path for MP4 to avoid caching thousands of PNGs.
* Workers keep UI responsive; communicate via `postMessage` with transferable objects when possible.

## 12) Privacy

* All processing local; no network calls except lazy-loading encoder scripts/wasm.
* Prominent text under upload: “Your video never leaves your device.”

## 13) Acceptance Criteria

* Uploading a video yields **10/20/30** evenly spaced stills per duration rules.
* User can select/deselect via checkboxes; count updates.
* Only **two settings** matter: **Frame Duration** (default 3.0s) and **Transition Duration** (default 0.5s). Transition type is always **Fade**.
* **Make Thumbnail** builds a working **preview** that plays exactly as the export will look.
* **Export WebM**, **Export GIF**, and **Export MP4** each:

  * start only when their button is clicked,
  * show progress, allow cancel,
  * produce a downloadable file named `thumb-YYYYMMDD-HHMMSS.ext`.
* App is static, framework-free, and stays responsive during encoding.

---

**Implementation notes for the agent**

* Keep code in **one HTML file + one JS file** plus workers; avoid build steps.
* Encode **deterministically**: both preview and export should read from the same timeline function given `{selectedStills, frameSec, transitionSec, fps}`.
* Start **MP4** export by asking for **WebM first** if it isn’t already generated, then transcode; otherwise, offer a “Render frames” fallback.
