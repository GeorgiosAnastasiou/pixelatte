// palette_order.js — arranging a palette's colours so neighbours look alike.
//
// A palette is a set, not a sequence: the order colours were added in carries no
// meaning, and mapping an image to a palette is order-independent. But a strip of
// swatches in insertion order looks like noise, and you cannot see at a glance
// what a palette *is* — which greens it has, whether its darks are warm or cold.
//
// So the strip is ordered by proximity: start at the reddest colour and walk to
// the nearest unused one, repeatedly. It is a greedy nearest-neighbour path,
// which is not the shortest possible tour, but it does the thing that matters —
// similar colours end up adjacent — in one pass and with no tuning.
//
// This is presentation only. The stored palette keeps its own order, so removing
// a swatch removes the colour the user pointed at rather than whichever colour
// happened to sort into that slot.

/** Pure red. The walk starts at whichever colour is closest to it. */
const RED = [255, 0, 0];


function toRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}


/**
 * Squared RGB distance.
 *
 * Squared because only comparisons matter and the square root changes no
 * ordering. Plain RGB rather than a perceptual space because that is what the
 * pixelation pipeline itself uses to pick nearest colours — a strip ordered by
 * one metric while the image is mapped by another would be quietly misleading.
 */
function distanceSq(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}


/**
 * Order a palette so similar colours sit together.
 *
 * @param {string[]} hexes
 * @returns {number[]} indices into [param hexes], in display order. Indices
 *   rather than colours so a caller can map a click back to the stored entry.
 */
export function proximityOrder(hexes) {
    const n = hexes.length;
    if (n <= 2) return hexes.map((_, i) => i);

    const rgb = hexes.map(toRgb);
    const used = new Array(n).fill(false);
    const order = [];

    // Start at the reddest colour. "Reddest" is nearest to pure red rather than
    // largest red channel: white has a full red channel and is not red.
    let current = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
        const d = distanceSq(rgb[i], RED);
        if (d < best) {
            best = d;
            current = i;
        }
    }

    order.push(current);
    used[current] = true;

    // Then walk to the nearest colour not yet placed, n-1 times.
    for (let step = 1; step < n; step++) {
        let next = -1;
        let nearest = Infinity;
        for (let i = 0; i < n; i++) {
            if (used[i]) continue;
            const d = distanceSq(rgb[current], rgb[i]);
            // Strict less-than keeps the earliest index on a tie, so the result
            // is stable for palettes containing duplicate colours.
            if (d < nearest) {
                nearest = d;
                next = i;
            }
        }
        order.push(next);
        used[next] = true;
        current = next;
    }

    return order;
}


/** The colours themselves, in proximity order. */
export function sortedByProximity(hexes) {
    return proximityOrder(hexes).map((i) => hexes[i]);
}
