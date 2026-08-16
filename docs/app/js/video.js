// video.js — the Video tab, streaming pipeline.
//
// Per frame, in order:
//   decode -> downscale to block res -> offsets -> temporal blend -> palette map -> emit
//
// The blend still happens after pixelation and before palette mapping, feeding
// back PRE-palette values, exactly as Pixelator.py did. The difference from the
// earlier build is that frames are no longer all held in memory first: the EMA
// is causal (s_t needs only c_t and s_{t-1}), so one frame of state is enough.
// That takes a 3-minute 1024-wide clip from ~28.5 GB to ~13 MB, with identical
// output.
//
// blendChunked() in core.js remains the parallel form, kept and tested, for if
// the per-frame work ever moves to the GPU and materialising the stack pays off.

import {
    applyOffsets, boxDownsample, mapToPalette, mapToPaletteExact, blockHeight,
} from './core.js';
import { chooseMapper, streamingMemoryMB } from './pipeline.js';
import { firstFrame, renderStill } from './preview.js';
import * as encodeWC from './encode.js';
import { getPaletteRgb, onPalettesChanged } from './palettes.js';
import { linkBlockSliders } from './blocksize.js';
import { $, makeLogger, bindSlider, fillPaletteSelect, downloadBlob, nextFrame, setLabel } from './ui.js';

const log = makeLogger('vid-log');

/** The only frame rates the slider can select. */
export const FPS_STEPS = [8, 12, 16, 24, 25, 30, 36, 48, 50, 60];

/**
 * Low frame rates are an aesthetic choice, but an 8 fps container plays badly.
 * The look rate and the container rate are separated: an 8 fps look is written
 * as 24 fps with each frame held 3x — visually identical, plays everywhere.
 */
const MIN_PLAYABLE_FPS = 24;
const STANDARD_FPS = [24, 25, 30, 48, 50, 60];

export function holdFactor(lookFps, enabled) {
    if (!enabled || lookFps >= MIN_PLAYABLE_FPS) return 1;
    for (const std of STANDARD_FPS) {
        if (std >= MIN_PLAYABLE_FPS && std % lookFps === 0) return std / lookFps;
    }
    return Math.ceil(MIN_PLAYABLE_FPS / lookFps);
}

let videoFile = null;
let sourceName = 'video';
let meta = { width: 0, height: 0, duration: 0 };
let outputBlob = null;
let running = false;
let cancelled = false;
let blocks = null;
let frameData = null;      // the opening frame, kept for the still preview
let previewTimer = null;

const currentFps = () => FPS_STEPS[Number($('vid-fps').value)] ?? 24;

const settings = () => ({
    fps: currentFps(),
    hold: holdFactor(currentFps(), $('vid-hold').checked),
    ...blocks.dims(),
    alpha: Number($('vid-smooth').value) / 100,
    offsets: [Number($('vid-r').value), Number($('vid-g').value), Number($('vid-b').value)],
    paletteName: $('vid-palette').value,
    exactDownscale: $('vid-exact').checked,
    forceRecorder: $('vid-recorder') ? $('vid-recorder').checked : false,
});

/**
 * Show the opening frame under the current settings.
 *
 * The clip is represented by a still rather than a player: what matters before
 * a render is what the pixelation and palette do to it, and a still can carry
 * every setting live. Frame rate and smoothing are the exceptions — both are
 * properties of a sequence, so they leave this preview untouched by nature.
 */
function renderPreview() {
    if (!frameData || running) return;
    const cfg = settings();
    const palette = getPaletteRgb(cfg.paletteName);
    if (!palette.length) return;

    const { lut } = chooseMapper(palette, cfg.bw * (cfg.bh || 1));
    const { bw, bh } = renderStill($('vid-canvas'), frameData,
        { bw: cfg.bw, bh: cfg.bh, offsets: cfg.offsets, palette, lut });

    $('vid-out').classList.add('hidden');
    $('vid-canvas').classList.remove('hidden');
    $('vid-frame-note').textContent =
        `First frame · ${bw}x${bh} blocks · ${palette.length} colours`;
}

/** Debounced, so dragging a slider stays responsive. */
function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
}

/**
 * Reduce one decoded frame to block-resolution RGB floats.
 *
 * Fast path: let the canvas scale the frame (GPU) and read back only the small
 * image. Avoids an 8 MB full-resolution readback per frame plus the JS box
 * filter — the single biggest per-frame cost at large block sizes.
 *
 * Exact path: full readback, offsets at source resolution, then a true box
 * filter. Matches Pixelator.py bit for bit. Note the two differ slightly even
 * with zero offsets, because the canvas filter is not exactly an area average.
 */
function makeReducer({ bw, bh, offsets, exact }, srcW, srcH) {
    const small = document.createElement('canvas');
    small.width = bw; small.height = bh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';

    let fullCanvas = null, fctx = null;
    if (exact) {
        fullCanvas = document.createElement('canvas');
        fullCanvas.width = srcW; fullCanvas.height = srcH;
        fctx = fullCanvas.getContext('2d', { willReadFrequently: true });
    }

    const out = new Float32Array(bw * bh * 3);

    return function reduce(source) {
        if (exact) {
            fctx.drawImage(source, 0, 0, srcW, srcH);
            const rgba = fctx.getImageData(0, 0, srcW, srcH).data;
            applyOffsets(rgba, offsets);
            return boxDownsample(rgba, srcW, srcH, bw, bh);
        }
        sctx.drawImage(source, 0, 0, bw, bh);
        const rgba = sctx.getImageData(0, 0, bw, bh).data;
        applyOffsets(rgba, offsets);        // at block res: cheap, and identical when offsets are 0
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
            out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2];
        }
        return out;
    };
}

/**
 * Decode, process and record in one pass.
 *
 * Playback runs at 1x because MediaRecorder timestamps by wall clock, so the
 * encode is real-time regardless; decoding faster would buy nothing and would
 * only risk outrunning the recorder. Total time is therefore about the clip
 * length. Replacing MediaRecorder with WebCodecs is what removes that floor.
 */
async function streamProcess(file, cfg, onProgress) {
    const palette = getPaletteRgb(cfg.paletteName);
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('could not decode this video'));
    });

    const srcW = video.videoWidth, srcH = video.videoHeight;
    const { bw, bh } = cfg;
    const pixels = bw * bh;

    const { lut, why } = chooseMapper(palette, pixels, Math.ceil(video.duration * cfg.fps));
    log(`Mapping with ${why}.`);

    const reduce = makeReducer({ bw, bh, offsets: cfg.offsets, exact: cfg.exactDownscale }, srcW, srcH);

    // --- output canvas + encoder ---
    const smallOut = document.createElement('canvas');
    smallOut.width = bw; smallOut.height = bh;
    const soctx = smallOut.getContext('2d');
    const outImage = soctx.createImageData(bw, bh);

    const out = $('vid-canvas');
    out.width = srcW; out.height = srcH;
    out.classList.remove('hidden');
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;

    // Two ways out. WebCodecs assigns explicit timestamps, so the timeline is
    // exact and encoding runs as fast as the CPU manages. MediaRecorder is the
    // fallback: it timestamps by wall clock, which forces real-time encoding
    // and drops frames on slow hardware.
    const containerFps = cfg.fps * cfg.hold;
    let wc = null;
    if (!cfg.forceRecorder) {
        try {
            if (await encodeWC.isSupported(srcW, srcH, containerFps)) {
                wc = await encodeWC.createEncoder({
                    width: srcW, height: srcH, fps: containerFps,
                    onError: (e) => log(`Encoder error: ${e.message}`, 'err'),
                });
                // H.264 needs even dimensions; match the canvas so frames aren't scaled.
                out.width = wc.width; out.height = wc.height;
                octx.imageSmoothingEnabled = false;
                log(`Encoding with WebCodecs (${wc.codec}) at ${containerFps} fps.`);
            }
        } catch (e) {
            log(`WebCodecs unavailable (${e.message}); falling back to MediaRecorder.`);
            wc = null;
        }
    }

    let mimeType = 'video/mp4', stream = null, track = null, chunks = null, rec = null, stopped = null;
    if (!wc) {
        mimeType = [
            'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
        ].find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
        stream = out.captureStream(0);
        track = stream.getVideoTracks()[0];
        chunks = [];
        rec = new MediaRecorder(stream, { mimeType });
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        stopped = new Promise((r) => { rec.onstop = r; });
        log(`Encoding with MediaRecorder (${mimeType}) — real time.`);
    }

    // --- streaming state: this is the whole memory footprint ---
    let state = null;                       // Float32Array, previous blended frame
    const a = cfg.alpha, ia = 1 - cfg.alpha;
    const interval = 1 / cfg.fps;
    const outFrameMs = 1000 / (cfg.fps * cfg.hold);
    let want = 0, frames = 0, emitted = 0, t0 = 0;
    let slowFrames = 0, filledSlots = 0;
    let lastReduced = null;

    /**
     * Emit one output slot from an already-reduced frame.
     *
     * Split from decoding because playback above 1x presents fewer frames than
     * we sample: when the media clock jumps past several wanted timestamps, each
     * missed slot is filled from the most recent frame so the output timeline
     * keeps its exact length. The blend still advances once per slot, so filled
     * slots continue smoothing rather than being frozen duplicates.
     */
    const emitFrom = async (cur) => {
        if (t0 === 0) t0 = performance.now();

        // Temporal blend against the running state (pre-palette, as required).
        if (a > 0) {
            if (state === null) {
                state = Float32Array.from(cur);          // s_0 = c_0
            } else {
                for (let i = 0; i < cur.length; i++) state[i] = ia * cur[i] + a * state[i];
            }
        } else {
            state = cur;
        }

        const mapped = lut ? mapToPalette(state, lut) : mapToPaletteExact(state, palette);

        for (let i = 0, j = 0; i < mapped.length; i += 3, j += 4) {
            outImage.data[j] = mapped[i];
            outImage.data[j + 1] = mapped[i + 1];
            outImage.data[j + 2] = mapped[i + 2];
            outImage.data[j + 3] = 255;
        }
        soctx.putImageData(outImage, 0, 0);
        octx.drawImage(smallOut, 0, 0, out.width, out.height);

        for (let k = 0; k < cfg.hold; k++) {
            if (wc) {
                // No pacing: the timestamp comes from the frame index, so the
                // output timeline is correct however long this takes.
                await wc.addFrame(out);
            } else {
                const due = t0 + emitted * outFrameMs;
                const wait = due - performance.now();
                if (wait > 0) await new Promise((r) => setTimeout(r, wait));
                else { slowFrames++; await nextFrame(); }
                track.requestFrame?.();
            }
            emitted++;
        }
        frames++;
    };

    /** Decode the current frame once, then fill every output slot it covers. */
    const consume = async (mediaTime) => {
        lastReduced = reduce(video);
        let guard = 0;
        while (want <= mediaTime + 1e-6 && guard < 600) {
            if (guard > 0) filledSlots++;      // this slot reused the same source frame
            await emitFrom(lastReduced);
            want += interval;
            guard++;
        }
    };

    if (rec) rec.start();
    // With WebCodecs there is no real-time constraint, so decode faster than
    // playback. 2x rather than 4x: above that the browser presents noticeably
    // fewer frames, and every skipped frame has to be filled from the previous
    // one. MediaRecorder must stay at 1x because it timestamps by wall clock.
    video.playbackRate = wc ? 2 : 1;

    const useRVFC = typeof video.requestVideoFrameCallback === 'function';
    if (useRVFC) {
        await new Promise((resolve, reject) => {
            let busy = false;
            const tick = async (_now, info) => {
                if (cancelled) { resolve(); return; }
                if (!busy && info.mediaTime + 1e-6 >= want) {
                    busy = true;
                    await consume(info.mediaTime);
                    busy = false;
                    onProgress(Math.min(1, info.mediaTime / video.duration));
                }
                if (!video.ended) video.requestVideoFrameCallback(tick);
            };
            video.requestVideoFrameCallback(tick);
            video.onended = () => resolve();
            video.onerror = () => reject(new Error('decode failed mid-playback'));
            video.play().catch(reject);
        });
    } else {
        // Seek fallback: slower, but works where rVFC is unavailable.
        for (let t = 0; t < video.duration && !cancelled; t += interval) {
            await new Promise((resolve) => {
                let done = false;
                const finish = () => { if (!done) { done = true; resolve(); } };
                video.onseeked = finish;
                video.currentTime = t;
                setTimeout(finish, 2000);      // guard: seeked can fail to fire
            });
            await consume(t);
            onProgress(Math.min(1, t / video.duration));
        }
    }

    // Playback can end a little before the final sampled timestamp, which would
    // leave the output shorter than the source. Pad to the expected count from
    // the last frame so the durations match.
    const expectedFrames = Math.max(1, Math.floor(video.duration * cfg.fps));
    while (lastReduced && frames < expectedFrames && !cancelled) {
        filledSlots++;
        await emitFrom(lastReduced);
    }

    let blob;
    if (wc) {
        blob = await wc.finish();
    } else {
        rec.stop();
        await stopped;
        blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    }
    // Detach before revoking: revoking a URL the element still references makes
    // it fire a failed request for the now-dead blob. Note no load() call here —
    // reloading an element whose src has just been removed requests the empty
    // string, which fails in its own right.
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);

    // Whether we kept up is a property of the finished timeline, not of
    // individual frames: compare elapsed wall clock against the timeline the
    // output claims to have. Anything under ~15% over is normal jitter.
    // Only meaningful for the MediaRecorder path — WebCodecs timestamps make
    // the timeline exact no matter how long processing took.
    const elapsedMs = t0 ? performance.now() - t0 : 0;
    const expectedMs = emitted * outFrameMs;
    const drift = wc ? 1 : (expectedMs > 0 ? elapsedMs / expectedMs : 1);

    return {
        blob, frames, slowFrames, filledSlots, drift, bw, bh, srcW, srcH,
        encoder: wc ? `WebCodecs ${wc.codec}` : `MediaRecorder ${mimeType}`,
    };
}

async function run() {
    if (running) { cancelled = true; return; }
    if (!videoFile) { alert('Choose a video first.'); return; }
    const cfg = settings();
    if (!getPaletteRgb(cfg.paletteName).length) { alert(`Palette "${cfg.paletteName}" is empty.`); return; }

    running = true; cancelled = false;
    const btn = $('vid-run');
    setLabel(btn, 'Cancel');
    $('vid-save').classList.add('hidden');
    $('vid-out').classList.add('hidden');
    $('vid-bar-proc').value = 0;
    $('vid-bar-enc').value = 0;
    $('vid-progress').classList.remove('hidden');

    try {
        log(`Streaming at ${cfg.fps} fps look, ${cfg.bw}x${cfg.bh} blocks, ` +
            `peak memory ~${streamingMemoryMB(cfg.bw, cfg.bh).toFixed(1)} MB.`);
        const t0 = performance.now();
        const r = await streamProcess(videoFile, cfg, (p) => {
            $('vid-bar-proc').value = p * 100;
            $('vid-bar-enc').value = p * 100;
        });
        $('vid-bar-proc').value = 100;
        $('vid-bar-enc').value = 100;

        if (!r.frames) throw new Error('no frames were processed');
        outputBlob = r.blob;

        const url = URL.createObjectURL(outputBlob);
        $('vid-out').src = url;
        $('vid-out').classList.remove('hidden');
        $('vid-canvas').classList.add('hidden');
        $('vid-save').classList.remove('hidden');
        $('vid-frame-note').textContent = 'Result — change any setting to go back to the preview.';

        const total = (performance.now() - t0) / 1000;
        $('vid-timing').textContent =
            `${r.frames} frames · ${cfg.bw}x${cfg.bh} · ${total.toFixed(1)}s total · ` +
            `${(outputBlob.size / 1048576).toFixed(1)} MB · ${r.encoder}`;
        log(`${cancelled ? 'Cancelled after' : 'Done in'} ${total.toFixed(1)}s — ` +
            `${r.frames} frames, ${(outputBlob.size / 1048576).toFixed(1)} MB.`, 'good');
        if (r.filledSlots > 0) {
            log(`${r.filledSlots} of ${r.frames} frames were filled from the previous frame ` +
                `because decoding could not deliver one in time. The duration is still exact.`);
        }
        if (r.drift > 1.15) {
            log(`Heads up: processing ran ${Math.round((r.drift - 1) * 100)}% behind the ` +
                `frame schedule, so the output plays slower than ${cfg.fps} fps. Try a ` +
                `smaller block size, or turn off the exact downscale.`, 'err');
        }
    } catch (err) {
        log(`Failed: ${err.message}`, 'err');
    } finally {
        running = false; cancelled = false;
        setLabel(btn, 'Run');
        $('vid-progress').classList.add('hidden');
    }
}

export function init() {
    onPalettesChanged((palettes) => fillPaletteSelect($('vid-palette'), palettes));

    const paintFps = () => {
        const look = currentFps();
        const hold = holdFactor(look, $('vid-hold').checked);
        $('vid-fps-val').textContent = String(look);
        $('vid-hold-note').textContent = hold > 1
            ? `Looks like ${look} fps, written as a ${look * hold} fps file (each frame held ${hold}x).`
            : `Written as a ${look} fps file.`;
    };
    bindSlider('vid-fps', null, paintFps);
    $('vid-hold').addEventListener('change', paintFps);
    paintFps();

    const marks = $('fps-marks');
    if (marks) {
        FPS_STEPS.forEach((f, i) => {
            const o = document.createElement('option');
            o.value = String(i); o.label = String(f);
            marks.appendChild(o);
        });
        $('vid-fps').setAttribute('list', 'fps-marks');
    }

    blocks = linkBlockSliders({
        wId: 'vid-bw', wValId: 'vid-bw-val', hId: 'vid-bh', hValId: 'vid-bh-val',
        badgeId: 'vid-blocks',
        getSourceSize: () => (meta.width ? { w: meta.width, h: meta.height } : null),
        onChange: schedulePreview,
    });

    // Smoothing is temporal, so it cannot show in a single frame — no preview.
    bindSlider('vid-smooth', 'vid-smooth-val');
    bindSlider('vid-r', 'vid-r-val', schedulePreview);
    bindSlider('vid-g', 'vid-g-val', schedulePreview);
    bindSlider('vid-b', 'vid-b-val', schedulePreview);
    $('vid-palette').addEventListener('change', schedulePreview);
    $('vid-exact').addEventListener('change', schedulePreview);

    $('vid-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        videoFile = file;
        sourceName = file.name.replace(/\.[^.]+$/, '');
        try {
            const frame = await firstFrame(file);
            frameData = frame.imageData;
            meta = { width: frame.width, height: frame.height, duration: frame.duration };
            $('vid-info').textContent =
                `${file.name} — ${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s`;
            $('vid-empty').classList.add('hidden');
            blocks.resync();          // new aspect ratio: recompute the locked dimension
            renderPreview();
            log(`Loaded ${file.name} (${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s).`);
        } catch (err) {
            frameData = null;
            log(`Could not read that video: ${err.message}`, 'err');
        }
    });

    $('vid-run').addEventListener('click', run);

    $('vid-save').addEventListener('click', () => {
        if (!outputBlob) return;
        const ext = outputBlob.type.includes('mp4') ? 'mp4' : 'webm';
        downloadBlob(outputBlob, `${sourceName}-pixelated.${ext}`);
        log(`Saved .${ext}.`, 'good');
    });

    log('Ready — choose a video.');
}

// Re-exported so the photo tab and tests can share the aspect helper.
export { blockHeight };
