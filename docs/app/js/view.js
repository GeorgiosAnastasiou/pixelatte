// view.js — zoom and pan over a block-resolution image.
//
// Everything on the photo stage is addressed in *blocks*, not pixels. That is
// the unit the user is actually editing: a brush covers 3 blocks, not 3 screen
// pixels, and it has to keep covering 3 blocks when the image is zoomed to 8x.
// So this owns one conversion — screen coordinates to block coordinates — and
// every feature built on top asks it rather than doing its own arithmetic.
//
// Drawing is nearest-neighbour throughout. Zooming a pixel-art tool with
// interpolation on would show a blurred approximation of the thing being
// edited, which defeats the purpose of zooming in to edit it.

const MAX_ZOOM = 64;
const MIN_ZOOM = 1;              // 1 means "the whole image fits the box"
/**
 * Zoom per pixel of wheel travel.
 *
 * Proportional to how far the wheel actually moved rather than a fixed step per
 * event. That distinction matters more than the constant: a mouse notch sends
 * one large delta and a touchpad sends a stream of tiny ones, so a fixed step
 * per event makes a touchpad fly while a mouse crawls.
 *
 * The constant is set from the mouse case, which is the one with a natural
 * reference. A notch on this platform arrives as deltaMode 1 with deltaY 3,
 * which is 48 pixels of travel. A browser's own zoom step is about 1.15x per
 * notch; half that speed is about 1.07x, so the rate is ln(1.07) / 48.
 */
const WHEEL_ZOOM_RATE = 0.0014;
const DELTA_TO_PX = { 0: 1, 1: 16, 2: 100 };

/**
 * A touchpad pinch is finer-grained than a mouse notch and feels slow at the
 * same rate, so it gets a little more per pixel of travel.
 *
 * Told apart by the shape of the event rather than by asking the browser, which
 * does not say: a mouse reports whole lines, or pixel deltas around 100 per
 * notch, while a pinch reports small pixel deltas many times a second.
 */
const TOUCHPAD_BOOST = 1.3;
const isFineGrained = (e) => e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
/** Pixels of middle-button drag per doubling. Up zooms in, as asked. */
const DRAG_ZOOM_PX = 180;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {HTMLCanvasElement} canvas the visible canvas
 * @param {() => ({canvas: HTMLCanvasElement, w: number, h: number}|null)} getSource
 *        the block-resolution image to display, or null when there is none
 */
export function createView(canvas, getSource) {
    let zoom = 1;
    let panX = 0, panY = 0;          // CSS px from the canvas box to the image
    let overlay = null;              // optional (ctx, geom) hook, drawn on top
    const listeners = new Set();

    const box = () => {
        const r = canvas.getBoundingClientRect();
        // Fall back to the attribute size before first layout, so geometry is
        // never divided by zero on the very first paint.
        return { w: r.width || canvas.width || 1, h: r.height || canvas.height || 1 };
    };

    /** Screen pixels per block, and where the image sits in the box. */
    function geometry() {
        const src = getSource();
        if (!src) return null;
        const b = box();
        const fit = Math.min(b.w / src.w, b.h / src.h);
        const px = fit * zoom;
        return { ...src, box: b, fit, px, drawnW: src.w * px, drawnH: src.h * px };
    }

    /**
     * Keep the image sensibly placed: centred while it is smaller than the box,
     * and never dragged so far that empty space appears beside it once it is
     * bigger. Without this, panning at high zoom loses the image off-screen and
     * there is no obvious way back.
     */
    function clampPan(g) {
        panX = g.drawnW <= g.box.w ? (g.box.w - g.drawnW) / 2 : clamp(panX, g.box.w - g.drawnW, 0);
        panY = g.drawnH <= g.box.h ? (g.box.h - g.drawnH) / 2 : clamp(panY, g.box.h - g.drawnH, 0);
        // Snap to whole pixels. The stage box is rarely a round number once the
        // interface scale has been applied — 539.75 tall is typical — so an
        // unrounded offset puts block edges on fractions and leaves the last row
        // of the canvas half covered. It also makes the same zoom level land
        // differently depending on how it was reached, so returning to Fit did
        // not reproduce the view it started from.
        panX = Math.round(panX);
        panY = Math.round(panY);
    }

    function redraw() {
        const g = geometry();
        if (!g) return;
        clampPan(g);

        const dpr = window.devicePixelRatio || 1;
        const wantW = Math.round(g.box.w * dpr), wantH = Math.round(g.box.h * dpr);
        if (canvas.width !== wantW || canvas.height !== wantH) {
            canvas.width = wantW; canvas.height = wantH;
        }

        const ctx = canvas.getContext('2d');
        // Clear in device pixels, not CSS pixels. The box is rarely a whole
        // number of them — 539.75 tall is typical once the interface scale is
        // applied — and clearing to 539.75 leaves a quarter of the last row
        // untouched, holding whatever the previous frame drew there. That sliver
        // is why returning to Fit did not reproduce the view it started from.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(g.canvas, panX, panY, Math.round(g.drawnW), Math.round(g.drawnH));

        if (overlay) overlay(ctx, { ...g, panX, panY });
        listeners.forEach((fn) => fn());
    }

    /** Block under a screen point, or null if the point misses the image. */
    function toBlock(clientX, clientY) {
        const g = geometry();
        if (!g) return null;
        const r = canvas.getBoundingClientRect();
        const bx = Math.floor((clientX - r.left - panX) / g.px);
        const by = Math.floor((clientY - r.top - panY) / g.px);
        if (bx < 0 || by < 0 || bx >= g.w || by >= g.h) return null;
        return { bx, by };
    }

    /**
     * A screen point as a fraction of the image, unclamped.
     *
     * Block coordinates are too coarse for a crop handle — at fit-to-window a
     * block is a couple of screen pixels — and a crop is measured in source
     * pixels anyway, so callers scale this by the source's own dimensions.
     */
    function toFraction(clientX, clientY) {
        const g = geometry();
        if (!g) return null;
        const r = canvas.getBoundingClientRect();
        return {
            fx: (clientX - r.left - panX) / g.drawnW,
            fy: (clientY - r.top - panY) / g.drawnH,
        };
    }

    /** Zoom about a fixed screen point, so what is under it stays under it. */
    function zoomAt(factor, clientX, clientY) {
        const g = geometry();
        if (!g) return;
        const r = canvas.getBoundingClientRect();
        const sx = clientX - r.left, sy = clientY - r.top;
        const bxf = (sx - panX) / g.px, byf = (sy - panY) / g.px;

        const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (next === zoom) return;
        zoom = next;

        const after = geometry();
        panX = sx - bxf * after.px;
        panY = sy - byf * after.px;
        redraw();
    }

    function reset() { zoom = 1; panX = panY = 0; redraw(); }

    // Re-fit when the stage changes shape: a rotated phone or a resized window
    // otherwise leaves the image anchored to a box that no longer exists.
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => redraw()).observe(canvas);
    } else {
        window.addEventListener('resize', redraw);
    }

    return {
        redraw, reset, toBlock, toFraction, zoomAt, geometry,
        get zoom() { return zoom; },
        setOverlay(fn) { overlay = fn; },
        onChange(fn) { listeners.add(fn); },
        panBy(dx, dy) { panX += dx; panY += dy; redraw(); },

        /**
         * Wire up the gestures.
         *
         * `painter` decides who owns a plain drag: when it reports itself
         * active the drag paints, and when it does not the same drag pans. That
         * is the usual bargain in an editor — the tool you picked gets the
         * pointer, and navigation moves to a modifier — and it avoids a
         * separate hand tool competing for room in the tool bar.
         */
        bindGestures(painter) {
            const pointers = new Map();
            let mode = null;             // 'paint' | 'pan' | 'zoom' | 'pinch'
            let last = null;
            let pinchDist = 0;

            const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
            const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

            canvas.addEventListener('pointerdown', (e) => {
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                // Capture keeps a stroke alive when the finger leaves the
                // canvas. It throws for a pointer the browser does not consider
                // active, which is not a reason to drop the gesture.
                try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }

                if (pointers.size === 2) {
                    // A second finger always wins: abandon whatever the first
                    // was doing rather than painting a streak while pinching.
                    if (mode === 'paint') painter.end?.();
                    const [a, b] = [...pointers.values()];
                    pinchDist = dist(a, b);
                    mode = 'pinch';
                    return;
                }
                if (pointers.size > 2) return;

                if (e.button === 1) { mode = 'zoom'; e.preventDefault(); }
                else if (e.button === 2) mode = 'pan';
                else if (painter.active?.()) {
                    // Brush and draw need a block to act on, so a press that
                    // misses the image is not their gesture. Crop works in
                    // source coordinates and has handles that sit on the very
                    // edge, so it takes the press wherever it lands.
                    const at = toBlock(e.clientX, e.clientY);
                    if (at || painter.anywhere?.()) { mode = 'paint'; painter.start(at, e); }
                } else mode = 'pan';

                last = { x: e.clientX, y: e.clientY };
            });

            canvas.addEventListener('pointermove', (e) => {
                if (!pointers.has(e.pointerId)) return;
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

                if (mode === 'pinch' && pointers.size >= 2) {
                    const [a, b] = [...pointers.values()];
                    const d = dist(a, b), c = mid(a, b);
                    if (pinchDist > 0 && d > 0) zoomAt(d / pinchDist, c.x, c.y);
                    pinchDist = d;
                    return;
                }
                if (!last) return;
                const dx = e.clientX - last.x, dy = e.clientY - last.y;

                if (mode === 'paint') {
                    const at = toBlock(e.clientX, e.clientY);
                    if (at || painter.anywhere?.()) painter.move(at, e);
                } else if (mode === 'pan') {
                    panX += dx; panY += dy; redraw();
                } else if (mode === 'zoom') {
                    // Wheel pressed and pushed away from you zooms in.
                    if (dy !== 0) zoomAt(Math.pow(2, -dy / DRAG_ZOOM_PX), last.x, last.y);
                }
                last = { x: e.clientX, y: e.clientY };
            });

            const release = (e) => {
                pointers.delete(e.pointerId);
                if (mode === 'paint') painter.end?.();
                if (pointers.size < 2 && mode === 'pinch') mode = null;
                if (pointers.size === 0) { mode = null; last = null; }
            };
            canvas.addEventListener('pointerup', release);
            canvas.addEventListener('pointercancel', release);

            // Zooming is what a wheel does over an image editor; without this
            // the page behind would scroll instead, which it cannot anyway.
            /**
             * Scroll pans, pinch zooms.
             *
             * A trackpad pinch reaches the page as a wheel event with ctrlKey
             * set — that is how browsers have always reported it — so the two
             * gestures are distinguishable without guessing. Plain two-finger
             * scrolling then means what it means everywhere else: move the
             * thing you are looking at. Ctrl and the wheel zooms for a mouse
             * too, and the page cannot zoom underneath either, because the
             * default is prevented.
             */
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const scale = DELTA_TO_PX[e.deltaMode] ?? 1;

                if (e.ctrlKey) {
                    const px = e.deltaY * scale;
                    const rate = WHEEL_ZOOM_RATE * (isFineGrained(e) ? TOUCHPAD_BOOST : 1);
                    // Clamped so one violent flick cannot jump the whole range.
                    zoomAt(Math.exp(-clamp(px, -400, 400) * rate), e.clientX, e.clientY);
                    return;
                }

                panX -= e.deltaX * scale;
                panY -= e.deltaY * scale;
                redraw();
            }, { passive: false });

            // The right button pans, so its menu has to go.
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        },
    };
}
