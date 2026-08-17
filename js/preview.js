// preview.js — putting a processed still on screen.
//
// Photo renders one image; Video renders its first frame so the settings can be
// judged before committing to a full pass. Both do exactly the same thing to
// get there, so it lives here once.

import { processStill } from './core.js';
import { spatialSmooth } from './smooth.js';

/**
 * Draw block-resolution RGB triplets into a canvas at full size.
 *
 * The blocks are drawn small and then scaled up by the canvas with smoothing
 * off — far cheaper than upscaling pixel by pixel in JS, and identical output.
 */
export function paintBlocks(canvas, rgb, bw, bh, outW, outH) {
    const small = document.createElement('canvas');
    small.width = bw; small.height = bh;
    const sctx = small.getContext('2d');
    const id = sctx.createImageData(bw, bh);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        id.data[j] = rgb[i]; id.data[j + 1] = rgb[i + 1]; id.data[j + 2] = rgb[i + 2]; id.data[j + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);

    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, outW, outH);
}

/**
 * Pixelate one ImageData against a palette and show the result.
 * @returns {{bw:number, bh:number}} the block grid actually used
 */
export function renderStill(canvas, imgData, { bw, bh, offsets, palette, lut, smooth }) {
    // Copy: processStill applies offsets in place and must not damage the source.
    const rgba = new Uint8ClampedArray(imgData.data);
    // Passed as a function rather than as settings, so core.js keeps its single
    // job and the landing page's demo — which imports core.js directly — does
    // not drag in a filter it never uses.
    const apply = smooth && smooth.radius >= 1
        ? { apply: (rgb, w, h) => spatialSmooth(rgb, w, h, smooth) }
        : null;
    const r = processStill(rgba, imgData.width, imgData.height,
        { bw, bh, offsets, palette, lut, smooth: apply });
    paintBlocks(canvas, r.rgb, r.bw, r.bh, imgData.width, imgData.height);
    return { bw: r.bw, bh: r.bh };
}

/** Wait for one frame to actually be presented, not merely seeked to. */
function framePresented(video) {
    return new Promise((resolve) => {
        if (typeof video.requestVideoFrameCallback === 'function') {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            video.requestVideoFrameCallback(finish);
            // Some decoders never present again while paused on an exact frame.
            setTimeout(finish, 400);
            return;
        }
        requestAnimationFrame(() => setTimeout(resolve, 80));
    });
}

/** Seek, and resolve once the decoder has caught up. */
function seekTo(video, t) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener('seeked', finish);
            resolve();
        };
        const timer = setTimeout(finish, 6000);
        video.addEventListener('seeked', finish);
        video.currentTime = t;
    });
}

/**
 * Is this frame essentially one flat colour?
 *
 * Video very often opens on black, and a black first frame is indistinguishable
 * from a failed grab — both give a blank preview and neither says which. If the
 * sample is flat, it is worth looking further into the clip before believing it.
 */
function isBlank(data, w, h) {
    let lo = 255, hi = 0;
    const step = Math.max(4, Math.floor((w * h) / 400) * 4);
    for (let i = 0; i < data.length; i += step) {
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return hi - lo < 8;
}

/**
 * Decode a video's opening frame to ImageData, plus the metadata the rest of
 * the pipeline needs. Used instead of a <video> preview: the app shows a still
 * of the current settings, not a player.
 *
 * Three things this has to get right, each of which produced a blank black
 * preview on a phone before:
 *
 *   - `preload` is metadata, not auto. A clip straight off a camera can be
 *     hundreds of megabytes, and buffering all of it before showing anything is
 *     the whole of the "it takes forever to load" problem.
 *   - A frame is drawn only once it has been *presented*, not merely seeked to.
 *     `seeked` fires when the decoder has moved, which on mobile is often
 *     before there is anything on the surface to copy — so drawImage produced
 *     an empty canvas.
 *   - A flat frame is retried further in. Plenty of clips genuinely open on
 *     black, and reporting that as the preview is indistinguishable from
 *     failing.
 */
export function firstFrame(file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';

        const cleanup = () => {
            video.removeAttribute('src');
            URL.revokeObjectURL(url);
        };
        const fail = (msg) => { cleanup(); reject(new Error(msg)); };
        video.onerror = () => fail('could not decode this video');

        video.onloadeddata = async () => {
            const meta = {
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration || 0,
            };
            if (!meta.width || !meta.height) { fail('this video reports no dimensions'); return; }

            const canvas = document.createElement('canvas');
            canvas.width = meta.width;
            canvas.height = meta.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            // Early, then progressively further in if what comes back is flat.
            const marks = [Math.min(0.04, meta.duration / 2)];
            if (meta.duration > 1) marks.push(meta.duration * 0.05, meta.duration * 0.25);

            try {
                let imageData = null;
                for (let i = 0; i < marks.length; i++) {
                    onProgress?.(i === 0 ? 'Reading the first frame…' : 'Opening frame is blank, looking further in…');
                    await seekTo(video, marks[i]);
                    await framePresented(video);
                    ctx.drawImage(video, 0, 0, meta.width, meta.height);
                    imageData = ctx.getImageData(0, 0, meta.width, meta.height);
                    if (!isBlank(imageData.data, meta.width, meta.height)) break;
                }
                cleanup();
                resolve({ imageData, ...meta });
            } catch (err) {
                fail(err.message || 'could not read a frame from this video');
            }
        };
    });
}
