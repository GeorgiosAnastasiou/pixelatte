// palettepicker.js — the palette chooser used by the Photo and Video tools.
//
// A palette is a set of colours, so a list of names is the one thing it cannot
// usefully be shown as: "Nord (16)" tells you nothing about whether Nord is the
// blue one. This renders the same named swatch strips the Palettes screen uses,
// so a palette looks the same wherever it is offered.
//
// The <select> it replaces stays in the DOM as the value holder. Every screen
// already reads `select.value` and listens for `change`, and keeping that
// contract means the picker is a presentation layer rather than a second source
// of truth that could disagree with the first.

import * as store from './store.js';
import { getPalettes, onPalettesChanged } from './palettes.js';
import { proximityOrder } from './palette_order.js';

/** Colours ordered by proximity, so a strip reads as a gradient not a jumble. */
function swatchStrip(colors) {
    const wrap = document.createElement('div');
    wrap.className = 'strip';
    for (const i of proximityOrder(colors)) {
        const s = document.createElement('span');
        s.style.background = colors[i];
        wrap.appendChild(s);
    }
    return wrap;
}

function sectionHeading(text) {
    const el = document.createElement('p');
    el.className = 'pal-section';
    el.textContent = text;
    return el;
}

/**
 * Replace a palette <select> with a list of swatch strips.
 *
 * @param {string} selectId id of the <select> that holds the chosen name
 */
export function attachPalettePicker(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    const list = document.createElement('div');
    list.className = 'pal-list pal-picker';
    list.setAttribute('role', 'listbox');
    sel.insertAdjacentElement('afterend', list);

    // Hidden rather than removed: it is still what the rest of the app reads.
    sel.hidden = true;

    const choose = (name) => {
        if (sel.value === name) return;
        sel.value = name;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        render();
    };

    const row = (name, colors) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pal-row';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(name === sel.value));

        const label = document.createElement('span');
        label.className = 'pal-row-name';
        label.textContent = name;

        const count = document.createElement('span');
        count.className = 'pal-row-count';
        count.textContent = String(colors.length);

        btn.append(swatchStrip(colors), label, count);
        btn.addEventListener('click', () => choose(name));
        return btn;
    };

    function render() {
        const palettes = getPalettes();
        list.innerHTML = '';

        const names = Object.keys(palettes);
        // Same split, and the same reasoning, as the Palettes screen: the ones
        // you made are what you are looking for, the shipped ones are reference.
        const mine = names.filter((n) => !store.isBuiltIn(n));
        const shipped = names.filter((n) => store.isBuiltIn(n));

        if (mine.length) {
            if (shipped.length) list.appendChild(sectionHeading('Your palettes'));
            for (const n of mine) list.appendChild(row(n, palettes[n]));
        }
        if (shipped.length) {
            if (mine.length) list.appendChild(sectionHeading('Built in'));
            for (const n of shipped) list.appendChild(row(n, palettes[n]));
        }
    }

    // The select is repopulated from the same event, and its listener is
    // registered first, so by the time this runs `sel.value` is already valid.
    onPalettesChanged(render);
    // Anything that sets the value elsewhere still moves the highlight.
    sel.addEventListener('change', render);
    render();
}
