// blocksize.js — aspect-locked block dimension sliders.
//
// The two sliders describe one value, because the aspect ratio is fixed. Moving
// width drives height and freezes the height slider; once the drag settles the
// freeze lifts, so the next gesture can come from either side. That prevents the
// two inputs from fighting mid-drag without ever permanently disabling one.

const SETTLE_MS = 400;

/** The block grid's shorter side never goes below this. */
export const MIN_SHORT_SIDE = 32;
/** Ceilings on the grid: one per side, whichever binds first wins. */
export const MAX_LONG_SIDE = 1920;
export const MAX_SHORT_SIDE = 1080;

/**
 * The slider bounds for one source image.
 *
 * The two sliders are one value seen twice, so there is really one range,
 * expressed on the image's longer side and paired to the shorter one by the
 * same rounding the aspect lock uses. Four things bound it:
 *
 *   long  >= 32 * long/short     the short side never drops below 32 blocks
 *   long  <= 1920                the ceiling on the long side
 *   short <= 1080                the ceiling on the short side
 *   both  <= the source itself   more blocks than pixels is an upscale, not
 *                                pixelation, so it is not offered
 *
 * Whichever ceiling binds first wins, which is why the answer changes shape
 * with the aspect ratio: 16:9 caps at 1920x1080 (both at once), 4:3 caps at
 * 1440x1080 (the short side binds), and 10:1 caps at 1920x192 (the long side
 * binds, and 192 simply follows).
 *
 * The pairing is computed rather than derived from a formula so it agrees with
 * blockHeight() exactly — otherwise a slider at its maximum could put its
 * partner one block past its own.
 *
 * @returns {{wMin:number, wMax:number, hMin:number, hMax:number}}
 */
export function blockRange(w, h) {
    if (!(w > 0) || !(h > 0)) {
        return { wMin: MIN_SHORT_SIDE, wMax: MAX_LONG_SIDE, hMin: MIN_SHORT_SIDE, hMax: MAX_SHORT_SIDE };
    }

    const short = Math.min(w, h);
    const long = Math.max(w, h);

    /** The short side that goes with a given long side — the aspect lock's rule. */
    const paired = (l) => Math.max(1, Math.round((l * short) / long));

    const longCeiling = Math.min(MAX_LONG_SIDE, long);
    const shortCeiling = Math.min(MAX_SHORT_SIDE, short);

    let longMax = Math.min(longCeiling, Math.floor((shortCeiling * long) / short));
    // The floor above can still leave the paired value a block over, because
    // pairing rounds rather than truncates. Walk it back until both hold.
    while (longMax > 1 && paired(longMax) > shortCeiling) longMax--;

    let longMin = Math.ceil((MIN_SHORT_SIDE * long) / short);
    while (paired(longMin) < MIN_SHORT_SIDE) longMin++;

    // Past about 60:1 — or on a source smaller than the floor itself — 32 on
    // the short side already costs more than a ceiling allows, so the floor is
    // simply unreachable. The ceilings are the constraints worth keeping, so
    // the floor moves to the long side instead: the grid still has a usable
    // range, it just cannot promise 32 blocks on an image that has no room for
    // them.
    if (longMin > longMax) longMin = Math.min(MIN_SHORT_SIDE, longMax);

    const longRange = { min: longMin, max: longMax };
    const shortRange = { min: paired(longMin), max: paired(longMax) };

    return w >= h
        ? { wMin: longRange.min, wMax: longRange.max, hMin: shortRange.min, hMax: shortRange.max }
        : { hMin: longRange.min, hMax: longRange.max, wMin: shortRange.min, wMax: shortRange.max };
}

/**
 * @param {object} o
 * @param {string} o.wId      width range input id
 * @param {string} o.wValId   width readout id
 * @param {string} o.hId      height range input id
 * @param {string} o.hValId   height readout id
 * @param {string} [o.badgeId] element to show "W x H blocks"
 * @param {() => ({w:number,h:number}|null)} o.getSourceSize  natural media size, or null if none loaded
 * @param {(dims:{bw:number,bh:number}) => void} [o.onChange]
 */
export function linkBlockSliders({ wId, wValId, hId, hValId, badgeId, getSourceSize, onChange }) {
    const wEl = document.getElementById(wId);
    const hEl = document.getElementById(hId);
    const wVal = document.getElementById(wValId);
    const hVal = document.getElementById(hValId);
    const badge = badgeId ? document.getElementById(badgeId) : null;

    let driver = null;         // 'w' | 'h' | null — which slider the user is holding
    let settleTimer = null;
    let pointerHeld = false;   // true between pointerdown and pointerup on a slider

    const aspect = () => {
        const s = getSourceSize();
        return s && s.w > 0 && s.h > 0 ? s.h / s.w : null;   // height per unit width
    };

    const clampTo = (el, v) => Math.max(Number(el.min), Math.min(Number(el.max), Math.round(v)));

    /**
     * Re-bound both sliders for the current source. Called whenever new media
     * loads: the limits are a property of the image's shape, not of the app.
     */
    function applyRange() {
        const s = getSourceSize();
        const r = blockRange(s ? s.w : 0, s ? s.h : 0);

        wEl.min = String(r.wMin); wEl.max = String(r.wMax);
        hEl.min = String(r.hMin); hEl.max = String(r.hMax);

        // A value from the previous image can sit outside the new bounds, and a
        // range input keeps whatever it was given until something reassigns it.
        wEl.value = String(clampTo(wEl, Number(wEl.value)));
        hEl.value = String(clampTo(hEl, Number(hEl.value)));
    }

    function paint() {
        wVal.textContent = wEl.value;
        hVal.textContent = hEl.value;
        if (badge) badge.textContent = `${wEl.value} x ${hEl.value} blocks`;
    }

    /**
     * Freeze the passive slider while the active one is being dragged.
     *
     * The lock is held for as long as the pointer is down, so a second finger
     * cannot grab the other slider mid-gesture no matter how long the drag
     * lasts or how still it is held. The timer is only a fallback for input
     * that has no pointer at all — keyboard arrows, or programmatic changes.
     */
    function setDriver(which) {
        driver = which;
        wEl.disabled = which === 'h';
        hEl.disabled = which === 'w';
        clearTimeout(settleTimer);
        if (!pointerHeld) settleTimer = setTimeout(release, SETTLE_MS);
    }

    function release() {
        clearTimeout(settleTimer);
        driver = null;
        pointerHeld = false;
        wEl.disabled = false;
        hEl.disabled = false;
    }

    for (const [el, which] of [[wEl, 'w'], [hEl, 'h']]) {
        el.addEventListener('pointerdown', () => {
            // A second finger landing on the locked slider must not steal the
            // gesture. `disabled` already blocks this in a real browser; this
            // makes it true regardless.
            if (driver && driver !== which) return;
            pointerHeld = true;
            setDriver(which);
        });
    }
    // Release on the window, not the slider: the pointer is frequently released
    // outside the element it started on.
    for (const ev of ['pointerup', 'pointercancel']) {
        window.addEventListener(ev, () => { if (pointerHeld) release(); });
    }

    function fromWidth(fire = true) {
        const a = aspect();
        if (a) hEl.value = clampTo(hEl, Number(wEl.value) * a);
        paint();
        if (fire) onChange?.(dims());
    }

    function fromHeight(fire = true) {
        const a = aspect();
        if (a) wEl.value = clampTo(wEl, Number(hEl.value) / a);
        paint();
        if (fire) onChange?.(dims());
    }

    // If a locked slider is changed anyway (synthetic event, assistive tech,
    // odd touch handling), the change is discarded and the ratio re-asserted
    // from whichever slider owns the gesture.
    wEl.addEventListener('input', () => {
        if (driver === 'h') { fromHeight(false); return; }
        setDriver('w');
        fromWidth();
    });
    hEl.addEventListener('input', () => {
        if (driver === 'w') { fromWidth(false); return; }
        setDriver('h');
        fromHeight();
    });

    const dims = () => ({ bw: Number(wEl.value), bh: Number(hEl.value) });

    applyRange();
    paint();

    return {
        dims,
        /**
         * Re-bound the sliders for newly loaded media and recompute the locked
         * dimension from whichever one the user last drove.
         */
        resync() {
            applyRange();
            if (driver === 'h') fromHeight(false); else fromWidth(false);
        },
        paint,
    };
}
