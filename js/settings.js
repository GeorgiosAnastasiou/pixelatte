// settings.js — the settings panel (currently: appearance).

import { THEMES, apply, save, getPreference, resolve, watchSystem } from './theme.js';
import { $ } from './ui.js';
import { getColorModel, setColorModel } from './colorpicker.js';

function card(theme, activeId, onPick) {
    const el = document.createElement('button');
    el.className = 'theme-card';
    el.type = 'button';
    el.setAttribute('aria-pressed', String(theme.id === activeId));
    el.dataset.theme = theme.id;

    const bars = document.createElement('div');
    bars.className = 'bars';
    for (const c of theme.swatch) {
        const s = document.createElement('span');
        s.style.background = c;
        bars.appendChild(s);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = theme.name;

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = theme.note;

    el.append(bars, name, note);
    el.addEventListener('click', () => onPick(theme.id));
    return el;
}

// Settings is a mode in the top bar now, shown and hidden by shell.js, so this
// module only has to render the panel's contents.
export function init() {
    const render = () => {
        const pref = getPreference();
        const activeId = resolve(pref);

        for (const [mode, gridId] of [['dark', 'theme-grid-dark'], ['light', 'theme-grid-light']]) {
            const grid = $(gridId);
            grid.innerHTML = '';
            for (const t of THEMES.filter((x) => x.mode === mode)) {
                grid.appendChild(card(t, activeId, (id) => { save(id); render(); }));
            }
        }

        const active = THEMES.find((t) => t.id === activeId);
        $('theme-current').textContent = pref === 'system'
            ? `Following your system setting — currently ${active.name}.`
            : `Using ${active.name}.`;
        // `on-toggle`, not `active-toggle`: the latter is the red "remove mode"
        // state from the palette editor, and red on a preference reads as a
        // warning rather than as "this is the current choice".
        $('theme-system').setAttribute('aria-pressed', String(pref === 'system'));
        $('theme-system').classList.toggle('on-toggle', pref === 'system');
    };

    $('theme-system').addEventListener('click', () => { save('system'); render(); });

    // --- colour model ---
    const NOTES = {
        rgb: 'Red, green and blue, 0 to 255 — the same axes the palette matcher and the '
           + 'brush work in, so a slider here moves what they move.',
        hsl: 'Hue, saturation and lightness. Better for hunting a colour with no name yet, '
           + 'because sweeping hue at a fixed lightness has no RGB equivalent.',
    };
    const modelRow = $('cp-model');
    const paintModel = () => {
        const active = getColorModel();
        for (const btn of modelRow.querySelectorAll('.shape')) {
            btn.setAttribute('aria-pressed', String(btn.dataset.model === active));
        }
        $('cp-model-note').textContent = NOTES[active] ?? '';
    };
    for (const btn of modelRow.querySelectorAll('.shape')) {
        btn.addEventListener('click', () => { setColorModel(btn.dataset.model); paintModel(); });
    }
    paintModel();

    apply(getPreference());
    render();
    watchSystem(render);
}
