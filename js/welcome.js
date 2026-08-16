// welcome.js — the pixel art shown before a section is chosen.
//
// Drawn in code rather than shipped as a file: it costs no bytes in the APK,
// scales to any screen, and is by construction made of the same blocks the app
// produces. Deterministic — the scene is identical on every launch.

export const ART_W = 80;
export const ART_H = 50;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const SKY = [[26, 20, 48], [48, 30, 72], [92, 45, 92], [156, 68, 96], [214, 106, 92]];
const SUN = [[255, 214, 128], [255, 168, 96]];
const RIDGE_FAR = [[64, 48, 92], [48, 36, 74]];
const RIDGE_NEAR = [[34, 26, 54], [22, 17, 38]];
const WATER = [[38, 30, 66], [30, 24, 54], [48, 36, 74]];

/** Two fixed sines: a ridge line that reads as terrain without any randomness. */
const ridge = (x, amp, phase, base) =>
    Math.round(base + amp * (Math.sin(x * 0.11 + phase) * 0.6 + Math.sin(x * 0.043 + phase * 2) * 0.4));

/**
 * @param {number} [w] block columns
 * @param {number} [h] block rows — pass the screen's proportions and the scene
 *   composes itself to fit, rather than being cropped to a strip by object-fit.
 * @returns {ImageData} the scene at block resolution.
 */
export function pixelArt(w = ART_W, h = ART_H) {
    const W = Math.max(16, Math.round(w));
    const H = Math.max(16, Math.round(h));

    const data = new Uint8ClampedArray(W * H * 4);
    const put = (x, y, [r, g, b]) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const i = (y * W + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    };

    // Everything is placed as a fraction of the frame, so the composition holds
    // from a wide desktop strip to a tall phone screen.
    const horizon = Math.round(H * 0.6);
    const sunX = Math.round(W * 0.66);
    const sunY = Math.round(horizon * 0.72);
    const sunR = clamp(Math.round(Math.min(W, H) * 0.13), 3, 14);

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (y < horizon) {
                // Sky banded into five steps, so the gradient stays blocky.
                put(x, y, SKY[Math.min(SKY.length - 1, Math.floor((y / horizon) * SKY.length))]);
            } else {
                // Water in horizontal stripes, lighter every third row.
                put(x, y, WATER[(y - horizon) % 3]);
            }
        }
    }

    // Sun: a disc, with its lower half banded so it reads as setting.
    for (let y = sunY - sunR; y <= sunY + sunR; y++) {
        for (let x = sunX - sunR; x <= sunX + sunR; x++) {
            const dx = x - sunX, dy = y - sunY;
            if (dx * dx + dy * dy > sunR * sunR) continue;
            if (y > sunY && (y - sunY) % 2 === 0) continue;   // horizontal cut lines
            put(x, y, SUN[y < sunY ? 0 : 1]);
        }
    }

    // Ridges, far behind near, both meeting the waterline. The sine frequencies
    // are per-frame rather than per-block, so a wide scene gets the same number
    // of peaks as a narrow one instead of turning into noise.
    const farAmp = Math.max(2, Math.round(horizon * 0.17));
    const nearAmp = Math.max(2, Math.round(horizon * 0.13));
    for (let x = 0; x < W; x++) {
        const u = (x / W) * 80;                              // the original block scale
        const far = ridge(u, farAmp, 0.4, horizon - Math.round(horizon * 0.27));
        for (let y = far; y < horizon; y++) put(x, y, RIDGE_FAR[(y - far) < 2 ? 0 : 1]);

        const near = ridge(u, nearAmp, 2.7, horizon - Math.round(horizon * 0.13));
        for (let y = near; y < horizon; y++) put(x, y, RIDGE_NEAR[(y - near) < 2 ? 0 : 1]);
    }

    // Sun reflection: a broken column of light on the water.
    const depth = Math.max(1, H - horizon);
    for (let y = horizon; y < H; y++) {
        const spread = 1 + Math.floor((y - horizon) / 5);
        if ((y - horizon) % 3 === 2) continue;               // gaps, so it shimmers
        for (let x = sunX - spread; x <= sunX + spread; x++) {
            const t = (y - horizon) / depth;
            put(x, y, [
                SUN[1][0] * (1 - t) + WATER[0][0] * t,
                SUN[1][1] * (1 - t) + WATER[0][1] * t,
                SUN[1][2] * (1 - t) + WATER[0][2] * t,
            ]);
        }
    }

    return new ImageData(data, W, H);
}

/**
 * Paint block-resolution ImageData into a visible canvas, upscaled with hard
 * edges. The canvas is sized in whole blocks so no block ever lands on a half
 * pixel; CSS then fits it to the stage.
 */
export function paint(canvas, imageData, targetWidth = 640) {
    const scale = Math.max(1, Math.round(targetWidth / imageData.width));

    const small = document.createElement('canvas');
    small.width = imageData.width;
    small.height = imageData.height;
    small.getContext('2d').putImageData(imageData, 0, 0);

    canvas.width = imageData.width * scale;
    canvas.height = imageData.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}
