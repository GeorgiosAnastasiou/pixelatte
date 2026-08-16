// colorpicker.js — HSL colour picker with sliders painted in the colours they select.
//
// Replaces <input type="color">, which the Android WebView renders as a plain
// grey button: you cannot see the hue you are choosing until after the fact.
// Here the hue track is a full spectrum, and the saturation and lightness tracks
// are repainted live so every track shows exactly the colours it can produce at
// the current setting — the slider position maps 1:1 to the output swatch.

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

/**
 * Mount a picker into `container`.
 * @param {HTMLElement} container
 * @param {{initial?: string, onChange?: (hex: string) => void}} opts
 */
export function createColorPicker(container, { initial = '#FF0000', onChange } = {}) {
    let { h, s, l } = rgbToHsl(...(parseHex(initial) || [255, 0, 0]));

    container.innerHTML = `
      <div class="cp">
        <div class="cp-top">
          <div class="cp-preview" title="Selected colour"></div>
          <input class="cp-hex" type="text" spellcheck="false" maxlength="7" aria-label="Hex colour">
        </div>
        <label class="cp-label">Hue <span class="cp-v cp-hv"></span></label>
        <input class="cp-slider cp-hue" type="range" min="0" max="359" step="1" aria-label="Hue">
        <label class="cp-label">Saturation <span class="cp-v cp-sv"></span></label>
        <input class="cp-slider cp-sat" type="range" min="0" max="100" step="1" aria-label="Saturation">
        <label class="cp-label">Lightness <span class="cp-v cp-lv"></span></label>
        <input class="cp-slider cp-lit" type="range" min="0" max="100" step="1" aria-label="Lightness">
      </div>`;

    const preview = container.querySelector('.cp-preview');
    const hexInput = container.querySelector('.cp-hex');
    const hueEl = container.querySelector('.cp-hue');
    const satEl = container.querySelector('.cp-sat');
    const litEl = container.querySelector('.cp-lit');
    const hv = container.querySelector('.cp-hv');
    const sv = container.querySelector('.cp-sv');
    const lv = container.querySelector('.cp-lv');

    // The hue track is a fixed spectrum; the other two are rebuilt whenever the
    // colour changes so each track always shows its own achievable range.
    const HUE_STOPS = Array.from({ length: 7 }, (_, i) => {
        const [r, g, b] = hslToRgb(i * 60, 100, 50);
        return `${toHex(r, g, b)} ${(i / 6 * 100).toFixed(0)}%`;
    }).join(', ');
    hueEl.style.background = `linear-gradient(to right, ${HUE_STOPS})`;

    const current = () => hslToRgb(h, s, l);
    const currentHex = () => toHex(...current());

    function paint(fireChange = true) {
        const hex = currentHex();
        preview.style.background = hex;
        if (document.activeElement !== hexInput) hexInput.value = hex;

        const [dr, dg, db] = hslToRgb(h, 100, 50);
        const hueColor = toHex(dr, dg, db);
        const [gr, gg, gb] = hslToRgb(h, 0, l);
        const [sr, sg, sb] = hslToRgb(h, 100, l);
        satEl.style.background =
            `linear-gradient(to right, ${toHex(gr, gg, gb)}, ${toHex(sr, sg, sb)})`;
        const [mr, mg, mb] = hslToRgb(h, s, 50);
        litEl.style.background =
            `linear-gradient(to right, #000, ${toHex(mr, mg, mb)}, #fff)`;

        hueEl.style.setProperty('--thumb', hueColor);
        satEl.style.setProperty('--thumb', hex);
        litEl.style.setProperty('--thumb', hex);

        hv.textContent = `${Math.round(h)}°`;
        sv.textContent = `${Math.round(s)}%`;
        lv.textContent = `${Math.round(l)}%`;

        hueEl.value = String(Math.round(h));
        satEl.value = String(Math.round(s));
        litEl.value = String(Math.round(l));

        if (fireChange) onChange?.(hex);
    }

    hueEl.addEventListener('input', () => { h = Number(hueEl.value); paint(); });
    satEl.addEventListener('input', () => { s = Number(satEl.value); paint(); });
    litEl.addEventListener('input', () => { l = Number(litEl.value); paint(); });

    hexInput.addEventListener('input', () => {
        const rgb = parseHex(hexInput.value.trim());
        if (!rgb) return;                       // ignore partial typing
        ({ h, s, l } = rgbToHsl(...rgb));
        paint();
    });
    hexInput.addEventListener('blur', () => paint());

    paint(false);

    return {
        getHex: currentHex,
        setHex(hex) {
            const rgb = parseHex(hex);
            if (!rgb) return;
            ({ h, s, l } = rgbToHsl(...rgb));
            paint(false);
        },
    };
}
