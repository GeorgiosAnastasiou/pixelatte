// crop.js — the crop rectangle, as geometry.
//
// Everything here is in *source pixels*: the crop selects a region of the
// original photo, and the block grid is recomputed over whatever it selects.
// Snapping the selection to the current blocks instead would bake in a block
// size you are about to change anyway.
//
// The output size is a separate number. Locking the ratio says what shape the
// selection has; an output size says what the result is resampled to. Lock 1:1
// on a 4032x3024 photo and you can drag a square anywhere from tiny to
// 3024x3024 — set the output to 1024x1024 and every one of them lands at
// 1024x1024. The two are related only in that an output size implies its ratio.
//
// No DOM in this file, so the awkward parts — ratio-locked corner drags,
// clamping to the image without breaking the ratio — are testable directly.

/** Corners, edge centres, and the whole rectangle. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Never let the selection collapse to something unusable. */
export const MIN_CROP = 16;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Width divided by height. */
export const ratioOf = (rect) => (rect.h > 0 ? rect.w / rect.h : 1);

/**
 * Read a ratio the way a person writes one: "16:9", "16/9", "1.5", "4 x 3".
 * @returns {number|null} width per unit height, or null if unreadable
 */
export function parseRatio(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim();
    if (!t) return null;

    const pair = /^(\d+(?:\.\d+)?)\s*[:\/xX×]\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (pair) {
        const w = Number(pair[1]), h = Number(pair[2]);
        return h > 0 && w > 0 ? w / h : null;
    }
    const single = Number(t);
    return Number.isFinite(single) && single > 0 ? single : null;
}

/** "1.7778" as "16:9" where it is close to a common one, else 2 decimals. */
export function formatRatio(r) {
    if (!Number.isFinite(r) || r <= 0) return '—';
    const COMMON = [
        [1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [5, 4], [21, 9], [2, 1], [3, 1],
        [3, 4], [2, 3], [9, 16], [10, 16], [4, 5], [9, 21], [1, 2], [1, 3],
    ];
    for (const [a, b] of COMMON) {
        if (Math.abs(r - a / b) < 0.005) return `${a}:${b}`;
    }
    return r.toFixed(2);
}

/** The largest rectangle of the given ratio that fits, centred on the source. */
export function largestRect(ratio, srcW, srcH) {
    let w = srcW, h = w / ratio;
    if (h > srcH) { h = srcH; w = h * ratio; }
    return {
        x: Math.round((srcW - w) / 2),
        y: Math.round((srcH - h) / 2),
        w: Math.round(w),
        h: Math.round(h),
    };
}

/** Keep a rectangle inside the source without changing its size. */
export function clampInside(rect, srcW, srcH) {
    const w = Math.min(rect.w, srcW);
    const h = Math.min(rect.h, srcH);
    return {
        x: Math.round(clamp(rect.x, 0, srcW - w)),
        y: Math.round(clamp(rect.y, 0, srcH - h)),
        w: Math.round(w),
        h: Math.round(h),
    };
}

/**
 * Reshape a rectangle to a ratio, keeping its centre, shrinking to fit.
 *
 * Shrinking rather than growing: growing could push the selection past an edge,
 * and the only way back would be to move it, which is not what asking for a
 * ratio meant.
 */
export function toRatio(rect, ratio, srcW, srcH) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    let w = rect.w, h = w / ratio;
    if (h > rect.h) { h = rect.h; w = h * ratio; }

    // Then make sure the result still fits the image at all.
    if (w > srcW) { w = srcW; h = w / ratio; }
    if (h > srcH) { h = srcH; w = h * ratio; }

    return clampInside({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h }, srcW, srcH);
}

/** Which handle a point is on, or 'move' inside, or null outside. */
export function hitTest(rect, x, y, tol) {
    const { x: rx, y: ry, w, h } = rect;
    const nearL = Math.abs(x - rx) <= tol;
    const nearR = Math.abs(x - (rx + w)) <= tol;
    const nearT = Math.abs(y - ry) <= tol;
    const nearB = Math.abs(y - (ry + h)) <= tol;
    const midX = Math.abs(x - (rx + w / 2)) <= tol;
    const midY = Math.abs(y - (ry + h / 2)) <= tol;
    const withinX = x >= rx - tol && x <= rx + w + tol;
    const withinY = y >= ry - tol && y <= ry + h + tol;

    // Corners first: at small sizes a corner is also near two edge centres, and
    // the corner is what the user is aiming at.
    if (nearL && nearT) return 'nw';
    if (nearR && nearT) return 'ne';
    if (nearL && nearB) return 'sw';
    if (nearR && nearB) return 'se';
    if (nearT && midX) return 'n';
    if (nearB && midX) return 's';
    if (nearL && midY) return 'w';
    if (nearR && midY) return 'e';
    if (withinX && withinY && x >= rx && x <= rx + w && y >= ry && y <= ry + h) return 'move';
    return null;
}

/**
 * Drag a handle to a point.
 *
 * With a ratio locked, a corner follows whichever axis moved further and the
 * other is derived, so the selection tracks the finger rather than fighting it.
 * An edge changes its own axis and the perpendicular one grows symmetrically
 * about the centre, which is the only way an edge drag can hold a ratio without
 * appearing to also move the rectangle.
 *
 * @param {object} rect the rectangle being dragged
 * @param {string} handle one of HANDLES
 * @param {number} x pointer position in source pixels
 * @param {number} y
 * @param {{ratio?: number|null, srcW: number, srcH: number}} opts
 */
export function dragHandle(rect, handle, x, y, { ratio = null, srcW, srcH }) {
    let left = rect.x, top = rect.y, right = rect.x + rect.w, bottom = rect.y + rect.h;

    if (!ratio) {
        if (handle.includes('w')) left = clamp(x, 0, right - MIN_CROP);
        if (handle.includes('e')) right = clamp(x, left + MIN_CROP, srcW);
        if (handle.includes('n')) top = clamp(y, 0, bottom - MIN_CROP);
        if (handle.includes('s')) bottom = clamp(y, top + MIN_CROP, srcH);
        return { x: Math.round(left), y: Math.round(top),
                 w: Math.round(right - left), h: Math.round(bottom - top) };
    }

    const isCorner = handle.length === 2;
    // The point that must not move: the opposite corner, or the opposite edge.
    const anchorX = handle.includes('w') ? right : handle.includes('e') ? left : rect.x + rect.w / 2;
    const anchorY = handle.includes('n') ? bottom : handle.includes('s') ? top : rect.y + rect.h / 2;

    let w, h;
    if (isCorner) {
        const dw = Math.abs(x - anchorX), dh = Math.abs(y - anchorY);
        if (dw >= dh * ratio) { w = dw; h = dw / ratio; } else { h = dh; w = dh * ratio; }
    } else if (handle === 'w' || handle === 'e') {
        w = Math.abs(x - anchorX);
        h = w / ratio;
    } else {
        h = Math.abs(y - anchorY);
        w = h * ratio;
    }

    w = Math.max(w, MIN_CROP);
    h = Math.max(h, MIN_CROP);
    if (w / h > ratio) h = w / ratio; else w = h * ratio;

    // Grow from the anchor in the direction of the drag, then pull the whole
    // thing back inside the image, shrinking on ratio if an edge is reached.
    const goingLeft = handle.includes('w');
    const goingUp = handle.includes('n');

    for (let guard = 0; guard < 4; guard++) {
        const nx = isCorner || handle === 'w' || handle === 'e'
            ? (goingLeft ? anchorX - w : anchorX)
            : anchorX - w / 2;
        const ny = isCorner || handle === 'n' || handle === 's'
            ? (goingUp ? anchorY - h : anchorY)
            : anchorY - h / 2;

        const overflow = Math.max(
            0 - nx, 0 - ny, nx + w - srcW, ny + h - srcH,
        );
        if (overflow <= 0.5) {
            return clampInside({ x: nx, y: ny, w, h }, srcW, srcH);
        }
        // Shrink proportionally and try again rather than clipping one side,
        // which would silently break the ratio the user locked.
        const shrink = Math.max(0.05, 1 - overflow / Math.max(w, h));
        w *= shrink; h = w / ratio;
        if (w < MIN_CROP || h < MIN_CROP) break;
    }

    const fitted = toRatio({ x: rect.x, y: rect.y, w, h }, ratio, srcW, srcH);
    return fitted;
}

/** Move the whole rectangle by a delta, staying inside the source. */
export function moveRect(rect, dx, dy, srcW, srcH) {
    return clampInside({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h }, srcW, srcH);
}

/**
 * The size the result will actually be.
 *
 * An output size wins over the selection's own size — that is what asking for
 * one means — but it is only honoured when both numbers are present, because
 * half a size is not a size.
 */
export function outputSize(rect, output) {
    const w = Number(output?.w), h = Number(output?.h);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1) {
        return { w: Math.round(w), h: Math.round(h), resampled: true };
    }
    return { w: rect.w, h: rect.h, resampled: false };
}
