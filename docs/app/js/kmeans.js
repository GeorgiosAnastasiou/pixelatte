// kmeans.js — palette extraction from an image.
//
// Upgrades over the original: k-means++ seeding instead of uniform-random picks
// (random init regularly produced duplicate/!dead centroids and needed luck to
// converge), and a deterministic RNG so the same image gives the same palette.

/** Squared RGB distance. */
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Small deterministic PRNG — same image in, same palette out. */
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * k-means++ seeding: first centre uniform, each subsequent centre chosen with
 * probability proportional to its squared distance from the nearest chosen
 * centre. Spreads the initial centres over the colour gamut.
 */
function seedPlusPlus(points, k, rand) {
    const centres = [points[Math.floor(rand() * points.length)]];
    const dist = new Float64Array(points.length).fill(Infinity);
    while (centres.length < k) {
        const last = centres[centres.length - 1];
        let total = 0;
        for (let i = 0; i < points.length; i++) {
            const d = d2(points[i], last);
            if (d < dist[i]) dist[i] = d;
            total += dist[i];
        }
        if (total <= 0) break;              // all points identical
        let r = rand() * total;
        let pick = points.length - 1;
        for (let i = 0; i < points.length; i++) {
            r -= dist[i];
            if (r <= 0) { pick = i; break; }
        }
        centres.push(points[pick]);
    }
    return centres;
}

/**
 * @param {Array<[number,number,number]>} points
 * @param {number} k
 * @param {{maxIter?: number, seed?: number}} opts
 * @returns {Array<[number,number,number]>} centroids, sorted by luminance
 */
export function kmeans(points, k, { maxIter = 30, seed = 1337 } = {}) {
    if (!points.length) return [];
    const rand = mulberry32(seed);
    let centres = seedPlusPlus(points, Math.min(k, points.length), rand);
    k = centres.length;

    const assign = new Int32Array(points.length).fill(-1);

    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for (let i = 0; i < points.length; i++) {
            let best = 0, bestD = Infinity;
            for (let j = 0; j < k; j++) {
                const d = d2(points[i], centres[j]);
                if (d < bestD) { bestD = d; best = j; }
            }
            if (assign[i] !== best) { assign[i] = best; changed = true; }
        }
        if (!changed) break;

        const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
        for (let i = 0; i < points.length; i++) {
            const s = sums[assign[i]], p = points[i];
            s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
        }
        for (let j = 0; j < k; j++) {
            if (sums[j][3] > 0) {
                centres[j] = [
                    Math.round(sums[j][0] / sums[j][3]),
                    Math.round(sums[j][1] / sums[j][3]),
                    Math.round(sums[j][2] / sums[j][3]),
                ];
            } else {
                // Empty cluster: re-seed on the point furthest from its centre,
                // which is more useful than the original's random re-pick.
                let far = 0, farD = -1;
                for (let i = 0; i < points.length; i++) {
                    const d = d2(points[i], centres[assign[i]]);
                    if (d > farD) { farD = d; far = i; }
                }
                centres[j] = points[far];
            }
        }
    }

    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return centres.sort((a, b) => lum(a) - lum(b));
}

/**
 * Sample pixels from RGBA image data, skipping fully transparent ones.
 * Sampling (rather than using every pixel) keeps extraction fast on big images.
 */
export function samplePixels(rgba, maxSamples = 20000) {
    const total = rgba.length / 4;
    const stride = Math.max(1, Math.floor(total / maxSamples));
    const pts = [];
    for (let p = 0; p < total; p += stride) {
        const i = p * 4;
        if (rgba[i + 3] < 8) continue;
        pts.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
    return pts;
}
