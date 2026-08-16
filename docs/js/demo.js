// demo.js — the pixelator running in the landing page.
//
// This imports the app's own core.js rather than reimplementing anything, so
// the demo cannot drift from the tool it is advertising: if the box filter or
// the nearest-colour search changes, this changes with it.

import { processStill, blockHeight, hexToRgb } from '../app/js/core.js';

const SRC_W = 720;
const SRC_H = 460;

// The same three the app ships with, from js/store.js.
const PALETTES = {
    'Gameboy': ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'],
    'CGA': ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'],
    'Grayscale': ['#000000', '#555555', '#AAAAAA', '#FFFFFF'],
};

let source = null;          // ImageData of the smooth original
let current = 'Gameboy';

/**
 * A deliberately smooth source image: soft gradients and round edges, so the
 * block grid and the palette mapping both have something visible to do. Drawn
 * in code because a landing page should not ship a photo to make its point.
 */
function drawSource() {
    const c = document.createElement('canvas');
    c.width = SRC_W; c.height = SRC_H;
    const x = c.getContext('2d', { willReadFrequently: true });

    const horizon = SRC_H * 0.62;

    const sky = x.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#1b1436');
    sky.addColorStop(0.45, '#5b2a63');
    sky.addColorStop(0.78, '#b4485f');
    sky.addColorStop(1, '#f08a52');
    x.fillStyle = sky;
    x.fillRect(0, 0, SRC_W, horizon);

    // Sun, with a glow that fades into the sky. Kept clear of the ridge line:
    // at four colours a sun tucked behind a hill merges into it, and the demo
    // wants a shape you can still recognise at 20 blocks across.
    const sunX = SRC_W * 0.68, sunY = horizon * 0.5, sunR = SRC_H * 0.115;
    // Kept tight on purpose. A wide glow quantises to a second ring of blocks
    // that reads as a hill around the sun rather than as light.
    const glow = x.createRadialGradient(sunX, sunY, sunR * 0.9, sunX, sunY, sunR * 1.75);
    glow.addColorStop(0, 'rgba(255, 206, 130, 0.55)');
    glow.addColorStop(1, 'rgba(255, 206, 130, 0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, SRC_W, horizon);

    const disc = x.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    disc.addColorStop(0, '#ffe9b0');
    disc.addColorStop(1, '#ff9d4d');
    x.fillStyle = disc;
    x.beginPath();
    x.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    x.fill();

    // Two ridges, drawn as smooth curves so the pixelation is what makes them
    // blocky rather than the drawing.
    const ridge = (yBase, amp, phase, fill) => {
        x.fillStyle = fill;
        x.beginPath();
        x.moveTo(0, SRC_H);
        for (let px = 0; px <= SRC_W; px += 4) {
            const t = px / SRC_W;
            const y = yBase
                + Math.sin(t * 6.1 + phase) * amp
                + Math.sin(t * 2.3 + phase * 1.7) * amp * 0.6;
            x.lineTo(px, y);
        }
        x.lineTo(SRC_W, SRC_H);
        x.closePath();
        x.fill();
    };
    ridge(horizon - SRC_H * 0.10, SRC_H * 0.045, 0.4, '#3a2a55');
    ridge(horizon - SRC_H * 0.02, SRC_H * 0.035, 2.7, '#241a38');

    // Water: a gradient plus a soft column of reflected light.
    const water = x.createLinearGradient(0, horizon, 0, SRC_H);
    water.addColorStop(0, '#2b2150');
    water.addColorStop(1, '#141026');
    x.fillStyle = water;
    x.fillRect(0, horizon, SRC_W, SRC_H - horizon);

    const refl = x.createLinearGradient(0, horizon, 0, SRC_H);
    refl.addColorStop(0, 'rgba(255, 170, 90, 0.55)');
    refl.addColorStop(1, 'rgba(255, 170, 90, 0)');
    x.fillStyle = refl;
    x.beginPath();
    x.moveTo(sunX - sunR * 0.5, horizon);
    x.lineTo(sunX + sunR * 0.5, horizon);
    x.lineTo(sunX + sunR * 2.2, SRC_H);
    x.lineTo(sunX - sunR * 2.2, SRC_H);
    x.closePath();
    x.fill();

    return x.getImageData(0, 0, SRC_W, SRC_H);
}

function render() {
    const bw = Number(document.getElementById('demo-blocks').value);
    const bh = blockHeight(bw, SRC_W, SRC_H);
    const palette = PALETTES[current].map(hexToRgb).filter(Boolean);

    // processStill applies offsets in place, so hand it a copy.
    const rgba = new Uint8ClampedArray(source.data);
    const r = processStill(rgba, SRC_W, SRC_H, { bw, bh, offsets: [0, 0, 0], palette });

    const small = document.createElement('canvas');
    small.width = r.bw; small.height = r.bh;
    const sctx = small.getContext('2d');
    const id = sctx.createImageData(r.bw, r.bh);
    for (let i = 0, j = 0; i < r.rgb.length; i += 3, j += 4) {
        id.data[j] = r.rgb[i]; id.data[j + 1] = r.rgb[i + 1]; id.data[j + 2] = r.rgb[i + 2];
        id.data[j + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);

    const out = document.getElementById('demo-canvas');
    out.width = SRC_W; out.height = SRC_H;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, SRC_W, SRC_H);

    document.getElementById('demo-blocks-val').textContent = `${r.bw} x ${r.bh}`;
}

function buildPaletteButtons() {
    const list = document.getElementById('demo-palettes');
    for (const [name, colors] of Object.entries(PALETTES)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pal';
        btn.setAttribute('aria-pressed', String(name === current));

        const bars = document.createElement('span');
        bars.className = 'bars';
        for (const c of colors) {
            const s = document.createElement('span');
            s.style.background = c;
            bars.appendChild(s);
        }

        const label = document.createElement('span');
        label.textContent = name;

        btn.append(bars, label);
        btn.addEventListener('click', () => {
            current = name;
            for (const b of list.children) b.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-pressed', 'true');
            render();
        });
        list.appendChild(btn);
    }
}

function main() {
    source = drawSource();
    buildPaletteButtons();
    document.getElementById('demo-blocks').addEventListener('input', render);
    render();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
