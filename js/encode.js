// encode.js — WebCodecs H.264 encoding into an MP4 container.
//
// Why this exists: MediaRecorder timestamps frames by wall clock, so encoding a
// 3-minute video takes at least 3 minutes and a machine that can't keep up
// silently drops frames. VideoEncoder takes an explicit timestamp per frame, so
// the output timeline is exact regardless of how fast the machine is, and it
// runs as fast as the CPU allows rather than in real time.
//
// WebCodecs has no muxer, hence the vendored mp4-muxer.

import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

/** H.264 needs even dimensions. */
export const evenize = (n) => (n % 2 === 0 ? n : n - 1);

/** Roughly 0.07 bits per pixel per frame, clamped to something sane. */
function bitrateFor(width, height, fps) {
    const bps = width * height * fps * 0.07;
    return Math.round(Math.min(Math.max(bps, 1_000_000), 40_000_000));
}

/**
 * Find an encoder configuration this device actually supports.
 * Baseline first — it is the most widely decodable; the higher profiles are
 * fallbacks for devices that refuse baseline at large resolutions.
 * @returns {Promise<object|null>} a supported config, or null if none
 */
export async function pickConfig(width, height, fps) {
    if (typeof VideoEncoder === 'undefined') return null;
    const w = evenize(width), h = evenize(height);
    for (const codec of ['avc1.42001f', 'avc1.4d0028', 'avc1.640028', 'avc1.42E01E']) {
        const config = {
            codec, width: w, height: h,
            bitrate: bitrateFor(w, h, fps),
            framerate: fps,
            avc: { format: 'avc' },
        };
        try {
            const res = await VideoEncoder.isConfigSupported(config);
            if (res?.supported) return res.config ?? config;
        } catch { /* try the next profile */ }
    }
    return null;
}

export const isSupported = async (width, height, fps) =>
    typeof VideoEncoder !== 'undefined' && (await pickConfig(width, height, fps)) !== null;

/**
 * Create an encoder that writes MP4.
 *
 * @param {{width:number,height:number,fps:number,onError?:(e:Error)=>void}} o
 * @returns {Promise<{addFrame:Function, finish:Function, dropped:number}>}
 */
export async function createEncoder({ width, height, fps, onError }) {
    const config = await pickConfig(width, height, fps);
    if (!config) throw new Error('no supported H.264 encoder configuration');

    const w = config.width, h = config.height;
    const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: w, height: h },
        // Puts the moov atom at the front, so the file is seekable and reports
        // its duration immediately instead of only once fully buffered.
        fastStart: 'in-memory',
    });

    let failed = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { failed = e; onError?.(e); },
    });
    encoder.configure(config);

    const frameDurationUs = Math.round(1_000_000 / fps);
    let count = 0;

    return {
        get width() { return w; },
        get height() { return h; },
        get codec() { return config.codec; },

        /**
         * Encode one frame. The timestamp is derived from the frame index, not
         * the clock, which is what keeps the output duration exact.
         * @param {CanvasImageSource} source
         */
        async addFrame(source) {
            if (failed) throw failed;
            const timestamp = count * frameDurationUs;
            const frame = new VideoFrame(source, { timestamp, duration: frameDurationUs });
            // Every 2 seconds, so seeking stays responsive.
            const keyFrame = count % Math.max(1, Math.round(fps * 2)) === 0;
            encoder.encode(frame, { keyFrame });
            frame.close();
            count++;

            // Backpressure: without this a fast producer queues thousands of
            // frames and the tab runs out of memory.
            while (encoder.encodeQueueSize > 8 && !failed) {
                await new Promise((r) => setTimeout(r, 1));
            }
        },

        get frameCount() { return count; },

        async finish() {
            if (failed) throw failed;
            await encoder.flush();
            encoder.close();
            muxer.finalize();
            return new Blob([muxer.target.buffer], { type: 'video/mp4' });
        },
    };
}
