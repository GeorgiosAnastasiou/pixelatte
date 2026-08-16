// logo.js — the mark: a homemade mug of coffee, in pixels.
//
// Defined once, here, as a grid of characters. The app paints it to a canvas
// and the website imports this same module and paints it too, so the two can
// never drift into being slightly different drawings of the same cup.
//
// Drawn at 24x24 and scaled by whole numbers only. A pixel logo scaled by 3.5
// is a blurry logo, so callers get an integer scale or nothing.

/**
 * The cup.
 *
 * o outline   c ceramic   k coffee   b base   s steam   . nothing
 *
 * Thrown rather than moulded: the sides bow out a little and the base is wider
 * than the rim, which is what makes it read as something someone made rather
 * than something a factory stamped.
 */
export const LOGO_ART = [
    '........................',
    '.........s....s.........',
    '........s......s........',
    '........s......s........',
    '.........s....s.........',
    '.........s....s.........',
    '........s......s........',
    '........................',
    '...oooooooooooooooo.....',
    '...okkkkkkkkkkkkkko.....',
    '...okkkkkkkkkkkkkko.....',
    '...occcccccccccccco.ooo.',
    '...occcccccccccccco.o..o',
    '..occcccccccccccccco.o.o',
    '..occcccccccccccccco.o.o',
    '..occcccccccccccccco.o.o',
    '..occcccccccccccccco.ooo',
    '..occcccccccccccccco....',
    '...occcccccccccccco.....',
    '...occcccccccccccco.....',
    '....oooooooooooooo......',
    '...bbbbbbbbbbbbbbbb.....',
    '..bbbbbbbbbbbbbbbbbb....',
    '........................',
];

/**
 * Fixed colours rather than theme tokens.
 *
 * The mark sits over whatever artwork the welcome screen picked, which could be
 * any colour at all, so it has to carry its own contrast. A logo that restyles
 * itself per theme is also not much of a logo.
 */
export const LOGO_COLORS = {
    o: '#2b1d12',                       // outline, warm near-black
    c: '#e6d5bb',                       // glazed clay
    k: '#6f4322',                       // coffee
    b: '#c2a683',                       // the base, in shadow
    s: 'rgba(255, 255, 255, 0.72)',     // steam
};

export const LOGO_W = LOGO_ART[0].length;
export const LOGO_H = LOGO_ART.length;

/**
 * Paint the mark into a canvas at a whole-number scale.
 *
 * @param {HTMLCanvasElement} canvas sized by this function, not by the caller
 * @param {number} scale device pixels per art pixel
 */
export function paintLogo(canvas, scale = 4) {
    const s = Math.max(1, Math.round(scale));
    canvas.width = LOGO_W * s;
    canvas.height = LOGO_H * s;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < LOGO_H; y++) {
        const row = LOGO_ART[y];
        for (let x = 0; x < row.length; x++) {
            const fill = LOGO_COLORS[row[x]];
            if (!fill) continue;
            ctx.fillStyle = fill;
            ctx.fillRect(x * s, y * s, s, s);
        }
    }
    return canvas;
}

/**
 * The mean colour of an ImageData, as [r, g, b].
 *
 * Used to tint the launch buttons to whatever picture is behind them, so they
 * sit in the artwork rather than on top of it. Sampled rather than summed —
 * every sixteenth pixel is far more than enough for an average, and a 12 MP
 * photo should not cost a full pass to find one colour.
 */
export function meanColor(imageData) {
    const d = imageData.data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 16) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return [128, 128, 128];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
