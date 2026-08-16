// theme.js — theme selection and persistence.
//
// Themes are pure CSS variable sets keyed by a data-theme attribute on <html>,
// so switching is one attribute write and nothing needs re-rendering.

const KEY = 'pixelator-theme';

export const THEMES = [
    // --- dark ---
    {
        id: 'graphite', name: 'Graphite', mode: 'dark', default: true,
        note: 'Neutral near-black with a violet accent',
        swatch: ['#0b0b0e', '#15151a', '#a78bfa'],
    },
    {
        id: 'midnight', name: 'Midnight', mode: 'dark',
        note: 'The original navy blue',
        swatch: ['#111827', '#1f2937', '#60a5fa'],
    },
    {
        id: 'ember', name: 'Ember', mode: 'dark',
        note: 'Warm charcoal with amber',
        swatch: ['#12100e', '#1c1917', '#fb923c'],
    },
    // --- light ---
    {
        id: 'daylight', name: 'Daylight', mode: 'light',
        note: 'Cool white with blue',
        swatch: ['#f6f8fb', '#ffffff', '#2563eb'],
    },
    {
        id: 'paper', name: 'Paper', mode: 'light',
        note: 'Warm off-white, low contrast',
        swatch: ['#faf9f7', '#ffffff', '#b45309'],
    },
    {
        id: 'sand', name: 'Sand', mode: 'light',
        note: 'Muted beige with green',
        swatch: ['#f5f1e8', '#fffdf8', '#557a46'],
    },
];

export const DEFAULT_THEME = THEMES.find((t) => t.default).id;
const byId = (id) => THEMES.find((t) => t.id === id);

/** 'system' follows the OS setting; anything else is an explicit theme id. */
export function resolve(pref) {
    if (pref && pref !== 'system' && byId(pref)) return pref;
    const prefersLight = typeof matchMedia === 'function'
        && matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'daylight' : DEFAULT_THEME;
}

export function getPreference() {
    try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function apply(pref) {
    const id = resolve(pref);
    document.documentElement.setAttribute('data-theme', id);
    const t = byId(id);
    // Let the browser style form controls and the status bar to match.
    document.documentElement.style.colorScheme = t.mode;
    return id;
}

export function save(pref) {
    try { localStorage.setItem(KEY, pref); } catch { /* private mode: session only */ }
    return apply(pref);
}

/** Keep 'system' live if the OS flips while the app is open. */
export function watchSystem(onChange) {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const handler = () => { if (getPreference() === 'system') onChange(apply('system')); };
    mq.addEventListener?.('change', handler);
}
