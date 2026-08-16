// preview.js — putting a processed still on screen.
//
// Photo renders one image; Video renders its first frame so the settings can be
// judged before committing to a full pass. Both do exactly the same thing to
// get there, so it lives here once.

import { processStill } from './core.js';

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
export function renderStill(canvas, imgData, { bw, bh, offsets, palette, lut }) {
    // Copy: processStill applies offsets in place and must not damage the source.
    const rgba = new Uint8ClampedArray(imgData.data);
    const r = processStill(rgba, imgData.width, imgData.height, { bw, bh, offsets, palette, lut });
    paintBlocks(canvas, r.rgb, r.bw, r.bh, imgData.width, imgData.height);
    return { bw: r.bw, bh: r.bh };
}

/**
 * Decode a video's opening frame to ImageData, plus the metadata the rest of
 * the pipeline needs. Used instead of a <video> preview: the app shows a still
 * of your settings, not a player.
 */
export function firstFrame(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        const fail = (msg) => { cleanup(); reject(new Error(msg)); };
        const cleanup = () => {
            video.removeAttribute('src');
            URL.revokeObjectURL(url);
        };

        video.onerror = () => fail('could not decode this video');

        video.onloadedmetadata = () => {
            const meta = {
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration,
            };
            if (!meta.width || !meta.height) { fail('this video reports no dimensions'); return; }

            const grab = () => {
                const canvas = document.createElement('canvas');
                canvas.width = meta.width;
                canvas.height = meta.height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(video, 0, 0);
                const imageData = ctx.getImageData(0, 0, meta.width, meta.height);
                cleanup();
                resolve({ imageData, ...meta });
            };

            // Seeking is what forces a frame to be decoded and presented. Some
            // containers hand back nothing at exactly 0, so nudge just past it;
            // the guard covers decoders that never fire `seeked` at all.
            const guard = setTimeout(grab, 3000);
            video.onseeked = () => { clearTimeout(guard); grab(); };
            video.currentTime = Math.min(0.04, (meta.duration || 1) / 2);
        };
    });
}
