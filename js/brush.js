// brush.js — nudging blocks by hand.
//
// The brush does not paint colours. It adds a small signed offset to a block's
// *pre-palette* value, and the block is then re-mapped to its nearest palette
// colour like every other block. So a nudge either moves a block across a
// palette boundary or does nothing visible at all, and the result can never
// contain a colour the palette does not have. That is the whole reason the
// range is +/-16: it is enough to push a stubborn block over the line to the
// neighbouring colour, and not enough to invent a new one.
//
// Two consequences worth stating, because both look like bugs otherwise:
//   - A nudge on a block far from any boundary shows no change. It is still
//     recorded, and it still counts toward the next nudge.
//   - Changing the palette re-decides every block, including nudged ones. The
//     offsets survive; what they map to does not.
//
// A block is nudged when the brush *arrives* on it. Holding still adds nothing
// however long the press lasts, and leaving a block and coming back nudges it
// again — see stamp() for why that is the rule rather than once per stroke.

/** Per channel, in either direction. */
export const MAX_DELTA = 16;

export const SHAPES = ['circle', 'square', 'hline', 'vline'];

/**
 * Which blocks a stamp of this shape and size covers, centred on 0,0.
 *
 * Sizes are diameters in blocks, so size 1 is a single block for every shape
 * and the four shapes stay comparable as the size slider moves. The circle is
 * the discrete disc — the same shape the account icon's head uses, and the one
 * a pixel artist expects — rather than a rasterised true circle.
 *
 * The span is exactly `n` blocks per axis, which is the part that used to be
 * wrong. Deriving the bounds by rounding a half-integer radius inward — ceil(-r)
 * to floor(r) — gives an odd span for every size, so an even size covered the
 * same blocks as the odd one below it: size 4 was three blocks wide, not four.
 * Worse, the fudge that kept the disc's cardinal tips at that width then reached
 * the corners too, and a size-4 *circle* came out as a solid 3x3 square. Sizes
 * 1, 2 and 4 were all square, whatever shape was selected.
 *
 * At even sizes the centre falls between blocks rather than on one, so it is
 * carried explicitly rather than assumed to be the origin: `c` is -0.5 for even
 * n and 0 for odd, and distances are measured from there.
 */
export function stampOffsets(shape, size) {
    const n = Math.max(1, Math.round(size));
    const out = [];
    const r = (n - 1) / 2;

    // n blocks per axis, as close to centred on the origin as an integer grid
    // allows. The block at `lo` is the first; there are n of them.
    const lo = -Math.floor(n / 2);
    const hi = lo + n - 1;
    const c = (lo + hi) / 2;          // 0 for odd n, -0.5 for even

    if (shape === 'hline') {
        for (let dx = lo; dx <= hi; dx++) out.push([dx, 0]);
        return out;
    }
    if (shape === 'vline') {
        for (let dy = lo; dy <= hi; dy++) out.push([0, dy]);
        return out;
    }

    for (let dy = lo; dy <= hi; dy++) {
        for (let dx = lo; dx <= hi; dx++) {
            const x = dx - c, y = dy - c;
            // +0.25 keeps the disc from losing its cardinal tips: a block is
            // included by the position of its centre, and the tip block's centre
            // sits exactly on the radius.
            if (shape === 'square' || x * x + y * y <= r * r + 0.25) out.push([dx, dy]);
        }
    }
    return out;
}

/**
 * A grid of accumulated per-block offsets, with undo.
 *
 * Undo stores the offsets a stroke replaced rather than the stroke itself, so
 * undoing overlapping strokes in any order restores exactly what was there.
 * Recording the deltas instead would need them subtracted in reverse order and
 * would drift the moment anything else touched a block in between.
 */
export function createBrushLayer(bw, bh) {
    let w = bw, h = bh;
    let deltas = new Int16Array(w * h * 3);

    const undoStack = [];            // [{ Map<index, [r,g,b]> }]
    const redoStack = [];
    let stroke = null;               // { touched: Set, before: Map } while drawing

    const inside = (bx, by) => bx >= 0 && by >= 0 && bx < w && by < h;

    return {
        get width() { return w; },
        get height() { return h; },
        get deltas() { return deltas; },
        get canUndo() { return undoStack.length > 0; },
        get canRedo() { return redoStack.length > 0; },
        /** Whether any offset is non-zero. Not the same as "has history": a
            layer can be edited back to all-zero and still have undo steps. */
        get hasEdits() { return deltas.some((v) => v !== 0); },

        /**
         * Resize to a new block grid.
         *
         * The offsets are dropped rather than resampled: they were decided
         * against a particular grid, and stretching them onto a different one
         * would put edits somewhere the user never put them. History goes with
         * them, because it could not be replayed onto the new grid either.
         */
        resize(nw, nh) {
            if (nw === w && nh === h) return false;
            w = nw; h = nh;
            deltas = new Int16Array(w * h * 3);
            undoStack.length = 0;
            redoStack.length = 0;
            stroke = null;
            return true;
        },

        clear() {
            if (!this.hasEdits) return false;
            undoStack.push(snapshotAll(deltas));
            redoStack.length = 0;
            deltas.fill(0);
            return true;
        },

        /** Begin a stroke. Everything until end() is one undo step. */
        begin() {
            stroke = { covered: new Set(), before: new Map() };
        },

        /**
         * Stamp at a block, with the shape's offsets.
         *
         * A block is nudged when the brush arrives on it, not once per stroke.
         * `covered` is what the *previous* stamp of this stroke sat on, so a
         * block still under the brush is left alone and a block the brush has
         * just moved onto is nudged — including one it covered earlier in the
         * same stroke and has come back to.
         *
         * That is the rule a hand expects from a brush: holding still adds
         * nothing however long the press lasts, so the nudge never depends on
         * how slowly the hand moved; but going over an area a second time is a
         * second pass, because deliberately sweeping back is how you ask for
         * more. A per-stroke mask could not tell those two apart — it refused
         * both, and the only way to build up a nudge was to lift and press
         * again for every pass.
         *
         * @returns {boolean} whether anything changed
         */
        stamp(bx, by, shape, size, rgbDelta) {
            if (!stroke) this.begin();
            let changed = false;
            const covered = new Set();

            for (const [dx, dy] of stampOffsets(shape, size)) {
                const x = bx + dx, y = by + dy;
                if (!inside(x, y)) continue;
                const idx = y * w + x;
                // Covered either way: what matters next time is where the brush
                // is now, not which of these blocks this pass happened to nudge.
                covered.add(idx);
                if (stroke.covered.has(idx)) continue;

                const base = idx * 3;
                if (!stroke.before.has(idx)) {
                    stroke.before.set(idx, [deltas[base], deltas[base + 1], deltas[base + 2]]);
                }
                for (let c = 0; c < 3; c++) {
                    const next = clampDelta(deltas[base + c] + rgbDelta[c]);
                    if (next !== deltas[base + c]) { deltas[base + c] = next; changed = true; }
                }
            }

            stroke.covered = covered;
            return changed;
        },

        /** Close the stroke, keeping it only if it actually changed something. */
        end() {
            if (!stroke) return false;
            const { before } = stroke;
            stroke = null;
            if (before.size === 0) return false;

            // A stroke that hit its limit everywhere changed nothing, and an
            // undo step that restores identical values is one the user has to
            // press through for no reason.
            let real = false;
            for (const [idx, prev] of before) {
                const base = idx * 3;
                if (deltas[base] !== prev[0] || deltas[base + 1] !== prev[1]
                    || deltas[base + 2] !== prev[2]) { real = true; break; }
            }
            if (!real) return false;

            undoStack.push(before);
            redoStack.length = 0;
            return true;
        },

        undo() { return step(undoStack, redoStack); },
        redo() { return step(redoStack, undoStack); },
    };

    function step(from, to) {
        const entry = from.pop();
        if (!entry) return false;
        const inverse = new Map();
        for (const [idx, prev] of entry) {
            const base = idx * 3;
            inverse.set(idx, [deltas[base], deltas[base + 1], deltas[base + 2]]);
            deltas[base] = prev[0]; deltas[base + 1] = prev[1]; deltas[base + 2] = prev[2];
        }
        to.push(inverse);
        return true;
    }
}

const clampDelta = (v) => Math.max(-MAX_DELTA, Math.min(MAX_DELTA, v));

/** Every non-zero offset, as one undo entry. Used by clear(). */
function snapshotAll(deltas) {
    const before = new Map();
    for (let idx = 0; idx * 3 < deltas.length; idx++) {
        const base = idx * 3;
        if (deltas[base] || deltas[base + 1] || deltas[base + 2]) {
            before.set(idx, [deltas[base], deltas[base + 1], deltas[base + 2]]);
        }
    }
    return before;
}

/**
 * Apply offsets to a block grid, in place, clamped to a byte.
 * @param {Float32Array} rgb pre-palette block values
 * @param {Int16Array} deltas the same grid, as signed offsets
 */
export function applyDeltas(rgb, deltas) {
    for (let i = 0; i < rgb.length; i++) {
        const v = rgb[i] + deltas[i];
        rgb[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return rgb;
}
