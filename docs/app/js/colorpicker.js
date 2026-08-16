// colorpicker.js — a colour picker whose sliders are painted in the colours
// they select, in either of two models.
//
// Replaces <input type="color">, which the Android WebView renders as a plain
// grey button: you cannot see the hue you are choosing until after the fact.
// Here every track shows exactly the colours it can produce at the current
// setting, so the slider position maps 1:1 to the output swatch.
//
// Two models, because they answer different questions. RGB is the default
// because it is the one the rest of the app speaks — palettes are hex, the
// brush nudges R/G/B, and nearest-colour matching is measured in RGB, so a
// channel slider here moves the same axis those do. HSL is better for finding a
// colour you cannot yet name — sweeping hue at fixed lightness has no RGB
// equivalent — so it stays available as a preference.

const MODEL_KEY = 'pixelator-color-model';
export const MODELS = ['rgb', 'hsl'];

/** h 0-360, s 0-100, l 0-100 -> [r,g,b] 0-255 */
export function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** [r,g,b] 0-255 -> {h,s,l} */
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    return { h: ((h % 360) + 360) % 360, s: s * 100, l: l * 100 };
}

const toHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const parseHex = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

/* ------------------------------------------------------- the preference */

const modelListeners = new Set();

/** RGB unless the user has said otherwise. */
export function getColorModel() {
    try {
        const saved = localStorage.getItem(MODEL_KEY);
        return MODELS.includes(saved) ? saved : 'rgb';
    } catch {
        return 'rgb';
    }
}

export function setColorModel(model) {
    if (!MODELS.includes(model)) return;
    try { localStorage.setItem(MODEL_KEY, model); } catch { /* private mode */ }
    modelListeners.forEach((fn) => fn(model));
}

/** Live pickers rebuild themselves when the preference changes. */
export const onColorModelChanged = (fn) => modelListeners.add(fn);

/* ------------------------------------------------------------ the picker */

/**
 * Mount a picker into `container`.
 *
 * @param {HTMLElement} container
 * @param {{initial?: string, onChange?: (hex: string) => void, model?: string}} opts
 *        `model` pins this picker to one model; omit it to follow the setting.
 */
export function createColorPicker(container, { initial = '#FF0000', onChange, model } = {}) {
    // RGB is the source of truth, because it is the only lossless one: every
    // hex has exactly one RGB triple, whereas a grey has no meaningful hue and
    // black has no meaningful saturation. The HSL sliders keep their own h/s/l
    // alongside it so dragging saturation to zero and back does not silently
    // lose the hue you were working from.
    let rgb = parseHex(initial) || [255, 0, 0];
    let hsl = rgbToHsl(...rgb);
    let current = model || getColorModel();
    let els = null;

    const currentHex = () => toHex(...rgb);

    const HUE_STOPS = Array.from({ length: 7 }, (_, i) => {
        const [r, g, b] = hslToRgb(i * 60, 100, 50);
        return `${toHex(r, g, b)} ${(i / 6 * 100).toFixed(0)}%`;
    }).join(', ');

    function markup(m) {
        const head = `
        <div class="cp-top">
          <div class="cp-preview" title="Selected colour"></div>
          <input class="cp-hex" type="text" spellcheck="false" maxlength="7" aria-label="Hex colour">
        </div>`;

        if (m === 'hsl') {
            return `<div class="cp">${head}
        <label class="cp-label">Hue <span class="cp-v cp-hv"></span></label>
        <input class="cp-slider cp-hue" type="range" min="0" max="359" step="1" aria-label="Hue">
        <label class="cp-label">Saturation <span class="cp-v cp-sv"></span></label>
        <input class="cp-slider cp-sat" type="range" min="0" max="100" step="1" aria-label="Saturation">
        <label class="cp-label">Lightness <span class="cp-v cp-lv"></span></label>
        <input class="cp-slider cp-lit" type="range" min="0" max="100" step="1" aria-label="Lightness">
      </div>`;
        }
        return `<div class="cp">${head}
        <label class="cp-label">Red <span class="cp-v cp-rv"></span></label>
        <input class="cp-slider cp-r" type="range" min="0" max="255" step="1" aria-label="Red">
        <label class="cp-label">Green <span class="cp-v cp-gv"></span></label>
        <input class="cp-slider cp-g" type="range" min="0" max="255" step="1" aria-label="Green">
        <label class="cp-label">Blue <span class="cp-v cp-bv"></span></label>
        <input class="cp-slider cp-b" type="range" min="0" max="255" step="1" aria-label="Blue">
      </div>`;
    }

    function paint(fireChange = true) {
        const hex = currentHex();
        els.preview.style.background = hex;
        if (document.activeElement !== els.hex) els.hex.value = hex;

        if (current === 'hsl') {
            const [dr, dg, db] = hslToRgb(hsl.h, 100, 50);
            const [gr, gg, gb] = hslToRgb(hsl.h, 0, hsl.l);
            const [sr, sg, sb] = hslToRgb(hsl.h, 100, hsl.l);
            const [mr, mg, mb] = hslToRgb(hsl.h, hsl.s, 50);
            els.sat.style.background =
                `linear-gradient(to right, ${toHex(gr, gg, gb)}, ${toHex(sr, sg, sb)})`;
            els.lit.style.background = `linear-gradient(to right, #000, ${toHex(mr, mg, mb)}, #fff)`;
            els.hue.style.setProperty('--thumb', toHex(dr, dg, db));
            els.sat.style.setProperty('--thumb', hex);
            els.lit.style.setProperty('--thumb', hex);

            els.hv.textContent = `${Math.round(hsl.h)}°`;
            els.sv.textContent = `${Math.round(hsl.s)}%`;
            els.lv.textContent = `${Math.round(hsl.l)}%`;
            els.hue.value = String(Math.round(hsl.h));
            els.sat.value = String(Math.round(hsl.s));
            els.lit.value = String(Math.round(hsl.l));
        } else {
            // Each track shows what that channel does while the other two hold,
            // so the gradient under the thumb is the range it can actually reach.
            const [r, g, b] = rgb;
            els.r.style.background = `linear-gradient(to right, ${toHex(0, g, b)}, ${toHex(255, g, b)})`;
            els.g.style.background = `linear-gradient(to right, ${toHex(r, 0, b)}, ${toHex(r, 255, b)})`;
            els.b.style.background = `linear-gradient(to right, ${toHex(r, g, 0)}, ${toHex(r, g, 255)})`;
            for (const k of ['r', 'g', 'b']) els[k].style.setProperty('--thumb', hex);

            els.rv.textContent = String(r);
            els.gv.textContent = String(g);
            els.bv.textContent = String(b);
            els.r.value = String(r);
            els.g.value = String(g);
            els.b.value = String(b);
        }

        if (fireChange) onChange?.(hex);
    }

    function build() {
        container.innerHTML = markup(current);
        els = {
            preview: container.querySelector('.cp-preview'),
            hex: container.querySelector('.cp-hex'),
            hue: container.querySelector('.cp-hue'),
            sat: container.querySelector('.cp-sat'),
            lit: container.querySelector('.cp-lit'),
            hv: container.querySelector('.cp-hv'),
            sv: container.querySelector('.cp-sv'),
            lv: container.querySelector('.cp-lv'),
            r: container.querySelector('.cp-r'),
            g: container.querySelector('.cp-g'),
            b: container.querySelector('.cp-b'),
            rv: container.querySelector('.cp-rv'),
            gv: container.querySelector('.cp-gv'),
            bv: container.querySelector('.cp-bv'),
        };

        if (current === 'hsl') {
            els.hue.style.background = `linear-gradient(to right, ${HUE_STOPS})`;
            const fromHsl = () => { rgb = hslToRgb(hsl.h, hsl.s, hsl.l); paint(); };
            els.hue.addEventListener('input', () => { hsl.h = Number(els.hue.value); fromHsl(); });
            els.sat.addEventListener('input', () => { hsl.s = Number(els.sat.value); fromHsl(); });
            els.lit.addEventListener('input', () => { hsl.l = Number(els.lit.value); fromHsl(); });
        } else {
            const fromRgb = () => { hsl = rgbToHsl(...rgb); paint(); };
            els.r.addEventListener('input', () => { rgb[0] = Number(els.r.value); fromRgb(); });
            els.g.addEventListener('input', () => { rgb[1] = Number(els.g.value); fromRgb(); });
            els.b.addEventListener('input', () => { rgb[2] = Number(els.b.value); fromRgb(); });
        }

        els.hex.addEventListener('input', () => {
            const parsed = parseHex(els.hex.value.trim());
            if (!parsed) return;                       // ignore partial typing
            rgb = parsed;
            hsl = rgbToHsl(...rgb);
            paint();
        });
        els.hex.addEventListener('blur', () => paint());

        paint(false);
    }

    build();

    // A picker that is following the preference rebuilds when it changes, so the
    // choice takes effect on panels that are already open.
    if (!model) {
        onColorModelChanged((next) => {
            if (next === current) return;
            current = next;
            build();
        });
    }

    return {
        getHex: currentHex,
        get model() { return current; },
        setHex(hex) {
            const parsed = parseHex(hex);
            if (!parsed) return;
            rgb = parsed;
            hsl = rgbToHsl(...rgb);
            paint(false);
        },
    };
}
