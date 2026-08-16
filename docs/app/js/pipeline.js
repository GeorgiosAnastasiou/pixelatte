// pipeline.js — decisions shared by the photo and video paths.

import { buildPaletteLUT } from './core.js';

/**
 * Exact nearest-colour search costs pixels x paletteSize. The LUT costs a fixed
 * build (32768 x paletteSize) plus one probe per pixel, so it wins once the
 * frame is big enough to amortise the build — at roughly 35-40k pixels,
 * near enough independent of palette size.
 *
 * Below the threshold exact is both fast and more accurate, so it is preferred.
 */
export const LUT_PIXEL_THRESHOLD = 40000;

export function chooseMapper(palette, pixelsPerFrame, frameCount = 1) {
    // With many frames the build is amortised further still, so lower the bar.
    const effective = pixelsPerFrame * Math.min(frameCount, 4);
    const useLut = effective > LUT_PIXEL_THRESHOLD || palette.length > 24;
    return {
        useLut,
        lut: useLut ? buildPaletteLUT(palette, 5) : null,
        why: useLut
            ? `LUT (${pixelsPerFrame.toLocaleString()} px/frame)`
            : `exact match (${pixelsPerFrame.toLocaleString()} px/frame)`,
    };
}

/**
 * Rough peak memory for the streaming video path: one blend state frame plus a
 * couple of scratch buffers, independent of clip length.
 */
export function streamingMemoryMB(bw, bh) {
    const stateF32 = bw * bh * 3 * 4;
    const scratch = bw * bh * 4 * 2;
    return (stateF32 + scratch) / 1048576;
}
