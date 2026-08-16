// store.js — palette persistence.
//
// Local-first by design: palettes are a few KB, so they live on the device and
// never need an account. The on-disk shape is deliberately plain, portable JSON
// ({ name: ["#RRGGBB", ...] }) so it can be exported, emailed, committed, or
// later synced by an optional account service without touching this file.

const KEY = 'pixelator-palettes';
const LEGACY_KEY = 'video-pixelator-palettes';   // the original pixelator.html key
const VERSION_KEY = 'pixelator-defaults-version';
/**
 * How many trailing colours of each palette were added by hand.
 *
 * Kept beside the palettes rather than inside them so the main store stays the
 * plain { name: ["#RRGGBB", ...] } shape that anything can read. A colour you
 * mixed yourself is not one the picture suggested, and the strip says so with a
 * divider — but that is a fact *about* the palette, not one of its colours.
 */
const ADDED_KEY = 'pixelator-palette-added';

/**
 * Bump this when palettes are added below, and stamp the new entries with it.
 *
 * Existing installs already have a palette store, so new defaults would never
 * reach them — but blindly re-adding every default on upgrade would resurrect
 * ones the user deliberately deleted. Recording which version each palette
 * arrived in lets an upgrade add only what is genuinely new.
 */
const DEFAULTS_VERSION = 3;

/**
 * The shipped palettes.
 *
 * Hardware palettes are exact: those machines could display these colours and
 * no others, which is what makes an image mapped to one read as that machine.
 * The editor schemes are the well-known values from their published themes and
 * are close enough to use, but they are transcribed rather than generated — if
 * one looks off against the original, trust the original.
 */
const CATALOGUE = [
    {
        name: 'Commodore 64', since: 2,
        colors: [
            '#000000', '#FFFFFF', '#880000', '#AAFFEE', '#CC44CC', '#00CC55',
            '#0000AA', '#EEEE77', '#DD8855', '#664400', '#FF7777', '#333333',
            '#777777', '#AAFF66', '#0088FF', '#BBBBBB',
        ],
    },
    {
        name: 'ZX Spectrum', since: 2,
        colors: [
            '#000000', '#0000D7', '#D70000', '#D700D7', '#00D700', '#00D7D7',
            '#D7D700', '#D7D7D7', '#0000FF', '#FF0000', '#FF00FF', '#00FF00',
            '#00FFFF', '#FFFF00', '#FFFFFF',
        ],
    },
    {
        name: 'PICO-8', since: 2,
        colors: [
            '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F',
            '#C2C3C7', '#FFF1E8', '#FF004D', '#FFA300', '#FFEC27', '#00E436',
            '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
        ],
    },
    {
        name: 'Gruvbox', since: 2,
        colors: [
            '#282828', '#3C3836', '#504945', '#665C54', '#BDAE93', '#EBDBB2',
            '#CC241D', '#FB4934', '#98971A', '#B8BB26', '#D79921', '#FABD2F',
            '#458588', '#83A598', '#B16286', '#D3869B', '#689D6A', '#8EC07C',
        ],
    },
    {
        name: 'Nord', since: 2,
        colors: [
            '#2E3440', '#3B4252', '#434C5E', '#4C566A', '#D8DEE9', '#E5E9F0',
            '#ECEFF4', '#8FBCBB', '#88C0D0', '#81A1C1', '#5E81AC', '#BF616A',
            '#D08770', '#EBCB8B', '#A3BE8C', '#B48EAD',
        ],
    },
    {
        name: 'Tokyo Night', since: 2,
        colors: [
            '#1A1B26', '#24283B', '#414868', '#565F89', '#A9B1D6', '#C0CAF5',
            '#F7768E', '#FF9E64', '#E0AF68', '#9ECE6A', '#73DACA', '#7DCFFF',
            '#7AA2F7', '#BB9AF7',
        ],
    },
    {
        name: 'Rose Pine', since: 2,
        colors: [
            '#191724', '#1F1D2E', '#26233A', '#6E6A86', '#908CAA', '#E0DEF4',
            '#EB6F92', '#F6C177', '#EBBCBA', '#31748F', '#9CCFD8', '#C4A7E7',
        ],
    },
    {
        name: 'Blue Haze', since: 3,
        colors: [
            '#382674', '#091521', '#291B4A', '#553379', '#452159', '#0D1541',
            '#663C8F', '#FB8AD9', '#A65191', '#6558B9', '#03C1B1', '#7649A7',
            '#5B3EAB', '#1D2B7F', '#393D8B',
        ],
    },
    {
        name: 'Sunset Peaks', since: 3,
        colors: [
            '#9464CF', '#C05CB1', '#382775', '#B264CB', '#7556C9', '#43378C',
            '#1A1526', '#CA5994', '#301A46', '#7355A5', '#AD3DA6', '#57469C',
            '#8B61B3', '#5B48C3', '#592C76',
        ],
    },
    {
        name: 'Sunset Peaks 2', since: 3,
        colors: [
            '#412047', '#39192B', '#5A2F4D', '#72404A', '#8D3A3D', '#1E3C37',
            '#6F2A36', '#512B2F', '#8B554D', '#1B1827', '#463D62', '#BF7A56',
            '#A5625C', '#D73C21', '#6F4068',
        ],
    },
    {
        name: 'Ornate Skies', since: 3,
        colors: [
            '#437FBA', '#FABA90', '#AD74B8', '#0E0739', '#5494C5', '#EC9ABE',
            '#6D448B', '#523A7E', '#835799', '#FDE694', '#C695CF', '#FBF7AE',
            '#F89CA2', '#336CA8', '#9B67A5',
        ],
    },
    {
        name: 'Kanagawa', since: 2,
        colors: [
            '#1F1F28', '#2A2A37', '#223249', '#363646', '#54546D', '#727169',
            '#DCD7BA', '#C8C093', '#7E9CD8', '#957FB8', '#FF5D62', '#E82424',
            '#98BB6C', '#7AA89F', '#FFA066', '#E6C384',
        ],
    },

    // The hardware palettes last. They are the most restrictive thing here —
    // four colours, or two — so they are what you reach for deliberately rather
    // than what should greet you at the top of the list.
    { name: 'Gameboy', since: 1, colors: ['#0F380F', '#306230', '#8BAC0F', '#9BBC0F'] },
    { name: 'Grayscale', since: 1, colors: ['#000000', '#555555', '#AAAAAA', '#FFFFFF'] },
    { name: 'CGA', since: 1, colors: ['#000000', '#55FFFF', '#FF55FF', '#FFFFFF'] },
    {
        name: '1-bit', since: 2,
        colors: ['#000000', '#FFFFFF'],
    },
];

export const DEFAULT_PALETTES = Object.fromEntries(
    CATALOGUE.map((p) => [p.name, p.colors]));

const BUILT_IN_NAMES = new Set(CATALOGUE.map((p) => p.name));

/**
 * Whether a palette is one this app ships.
 *
 * Decided by name, which has one consequence worth knowing: editing a shipped
 * palette's colours leaves it listed as built-in, while renaming it makes it
 * yours. That is the right way round — a rename is a deliberate act of adoption,
 * an edit is just tuning.
 */
export function isBuiltIn(name) {
    return BUILT_IN_NAMES.has(name);
}

const isHex = (c) => /^#[0-9A-F]{6}$/i.test(c);

/** Drop anything malformed so a corrupted store can't break the app. */
function sanitize(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [name, colors] of Object.entries(obj)) {
        if (typeof name !== 'string' || !Array.isArray(colors)) continue;
        const clean = colors.filter((c) => typeof c === 'string' && isHex(c)).map((c) => c.toUpperCase());
        out[name] = clean;
    }
    return out;
}

function storedVersion() {
    const raw = Number(localStorage.getItem(VERSION_KEY));
    // A store that predates this mechanism holds version 1 by definition.
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Add palettes introduced since the store was last seen.
 *
 * Only entries newer than the recorded version are considered, so a palette the
 * user deleted stays deleted; only genuinely new ones appear. A name already in
 * use is left alone — the user's version of "Nord" wins over the shipped one.
 */
function addNewDefaults(palettes) {
    const from = storedVersion();
    if (from >= DEFAULTS_VERSION) return { palettes, added: 0 };

    let added = 0;
    for (const entry of CATALOGUE) {
        if (entry.since > from && !(entry.name in palettes)) {
            palettes[entry.name] = entry.colors.slice();
            added++;
        }
    }
    return { palettes, added };
}


/**
 * Yours first, then the shipped ones in catalogue order.
 *
 * The stored object keeps insertion order, so a store written by an older
 * version has the old arrangement baked into it. Reordering on load is what
 * lets the shipped list be rearranged without asking anyone to reset anything.
 */
function inCatalogueOrder(palettes) {
    const rank = new Map(CATALOGUE.map((e, i) => [e.name, i]));
    const names = Object.keys(palettes);
    const mine = names.filter((n) => !rank.has(n));
    const shipped = names.filter((n) => rank.has(n)).sort((a, b) => rank.get(a) - rank.get(b));

    const out = {};
    for (const n of mine) out[n] = palettes[n];
    for (const n of shipped) out[n] = palettes[n];
    return out;
}

export function load() {
    try {
        let raw = localStorage.getItem(KEY);
        if (!raw) {
            // One-time migration from the original single-file version.
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy) {
                raw = legacy;
                localStorage.setItem(KEY, legacy);
            }
        }
        if (!raw) {
            save({ ...DEFAULT_PALETTES });
            localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
            return { ...DEFAULT_PALETTES };
        }

        const parsed = sanitize(JSON.parse(raw));
        if (!Object.keys(parsed).length) {
            localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
            return { ...DEFAULT_PALETTES };
        }

        const { palettes, added } = addNewDefaults(parsed);
        const ordered = inCatalogueOrder(palettes);
        if (added) save(ordered);
        localStorage.setItem(VERSION_KEY, String(DEFAULTS_VERSION));
        return ordered;
    } catch {
        return { ...DEFAULT_PALETTES };
    }
}

/** { name: count } — how many of each palette's last colours were hand-added. */
export function loadAdded() {
    try {
        const raw = JSON.parse(localStorage.getItem(ADDED_KEY) || '{}');
        const out = {};
        if (raw && typeof raw === 'object') {
            for (const [name, n] of Object.entries(raw)) {
                if (typeof name === 'string' && Number.isFinite(n) && n > 0) out[name] = Math.floor(n);
            }
        }
        return out;
    } catch {
        return {};
    }
}

export function saveAdded(added) {
    try {
        // Only the non-zero entries: the common case is a palette with none,
        // and storing those would grow the record for no information.
        const trimmed = {};
        for (const [name, n] of Object.entries(added || {})) if (n > 0) trimmed[name] = n;
        localStorage.setItem(ADDED_KEY, JSON.stringify(trimmed));
        return true;
    } catch {
        return false;
    }
}

export function save(palettes) {
    try {
        localStorage.setItem(KEY, JSON.stringify(palettes));
        return true;
    } catch {
        return false;   // quota or private mode; caller surfaces it
    }
}

/**
 * Serialise for the export button.
 *
 * Wrapped rather than flat once there is anything to say beyond the colours, so
 * the divider survives a round trip through a file. The old flat shape is still
 * written when no palette has hand-added colours, and still read either way, so
 * files move in both directions between versions.
 */
export function toJSON(palettes, added) {
    const meta = {};
    for (const [name, n] of Object.entries(added || {})) if (n > 0 && name in palettes) meta[name] = n;
    if (!Object.keys(meta).length) return JSON.stringify(palettes, null, 2);
    return JSON.stringify({ format: 'pixelator-palettes', palettes, added: meta }, null, 2);
}

/** Accept either the flat map or the wrapped form. */
function unwrap(parsed) {
    if (parsed && typeof parsed === 'object' && parsed.palettes && typeof parsed.palettes === 'object') {
        return { palettes: parsed.palettes, added: parsed.added || {} };
    }
    return { palettes: parsed, added: {} };
}

/**
 * Merge an imported file into the current set. Name collisions get a suffix
 * rather than overwriting, so importing can never destroy existing work.
 * @returns {{merged: object, added: number, renamed: string[]}}
 */
export function mergeImported(current, text, currentAdded = {}) {
    const raw = unwrap(JSON.parse(text));
    const incoming = sanitize(raw.palettes);
    const merged = { ...current };
    const mergedAdded = { ...currentAdded };
    const renamed = [];
    let added = 0;
    for (const [name, colors] of Object.entries(incoming)) {
        let target = name;
        if (target in merged) {
            if (JSON.stringify(merged[target]) === JSON.stringify(colors)) continue; // identical, skip
            let n = 2;
            while (`${name} (${n})` in merged) n++;
            target = `${name} (${n})`;
            renamed.push(target);
        }
        merged[target] = colors;
        // Clamp: a file could claim more hand-added colours than the palette has.
        const claimed = Number(raw.added?.[name]);
        if (Number.isFinite(claimed) && claimed > 0) {
            mergedAdded[target] = Math.min(Math.floor(claimed), colors.length);
        }
        added++;
    }
    return { merged, added, renamed, mergedAdded };
}
