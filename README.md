# Pixelator

Pixelate photos and video against a palette you control.

Set the block grid, pick the colours the image is allowed to use, and watch the
result redraw as you drag. It runs entirely in the browser — no server, no
account, nothing uploaded. The Android app is the same code in a WebView.

**Try it:** https://georgiosanastasiou.github.io/video_pixelator/

---

## One codebase, two targets

There is no separate "web version" and "Android version". The same
`index.html`, `css/` and `js/` are:

- **served directly** by any web server, and
- **wrapped** by Capacitor into an Android app.

A change lands in both. What differs is only input and screen size, and the
layout adapts on its own — a bottom tool bar and popovers-above on a phone, a
tool rail down the left and popovers-beside on a desktop.

---

## Running it

The app is static files, but it is made of ES modules, and browsers refuse to
load those over `file://`. It needs a server, however trivial:

    python3 -m http.server 8000

Then open <http://localhost:8000>. Any static server works.

To preview the **website** (landing page plus the app underneath it):

    ./build-site.sh
    python3 -m http.server -d docs 8000

`/` is the landing page, `/app/` is the app.

---

## Layout

    index.html          the app
    css/app.css         one stylesheet, six themes, no framework
    js/                 ES modules, no build step, no dependencies
    assets/welcome/     drop pixel art here; one is shown at random on launch
    docs/               the website. Committed, because Pages serves it
      app/              generated copy of the app — do not edit, run build-site.sh
    android/            Capacitor Android project
    samples/            test media, gitignored (50 MB)
    pixelator.html      the original single-file version, kept for reference

Two scripts define what gets copied where, so the two build targets can never
drift apart:

    stage-app.sh <dest>   the single definition of "the app"
    sync-web.sh           -> www/,      for Capacitor
    build-site.sh         -> docs/app/, for GitHub Pages

Edit the files at the repo root. `www/` and `docs/app/` are generated.

---

## The pieces worth knowing

**`js/core.js`** is the whole image pipeline and nothing else: box-filter
downsample to a block grid, then map each block to its nearest palette colour.
It has no DOM in it, which is why the landing page's live demo can import the
real thing rather than a copy.

**Range and mapping are cell-based, not analytic.** Nearest-colour search is
exact for small jobs; above roughly 40,000 pixels per frame, or palettes over 24
colours, it builds a lookup table over a 32x32x32 colour cube instead. The
threshold is where the table stops being the more expensive option.

**Video streams.** Frames are decoded, reduced, blended and encoded one at a
time rather than collected first — the temporal smoothing only needs the
previous blended frame to produce the next. A 3-minute clip at 1024 blocks wide
is ~13 MB streamed against ~28.5 GB held as a frame stack, with identical
output.

**Palettes live in `localStorage`** as plain `{ name: ["#RRGGBB", ...] }`, and
export to a JSON file you can move between devices yourself. Shipped palettes
are versioned: adding new ones delivers them to existing installs without
resurrecting any the user deliberately deleted.

**Block sizes come from the image.** The grid runs from 32 blocks on the
picture's shorter side up to 1920 on its longer one and 1080 on the shorter,
never exceeding the source's own resolution. A 16:9 photo therefore offers
57–1920 horizontally against 32–1080 vertically, and both sliders hit their ends
together.

---

## Tests

No framework, no runner — each suite is a script that prints and exits non-zero
on failure:

    node js/core.test.js            # pipeline: blend, palette mapping, downsample
    node js/extract.test.js         # palette extraction from an image
    node js/blocksize.test.js       # block-grid limits and aspect locking
    node js/palette_order.test.js   # proximity ordering of a palette strip

114 checks. They need only Node — no npm install.

---

## Building the Android app

Requires the Android SDK and **JDK 17** (newer JDKs are not yet supported by the
Gradle plugin).

    npm install                 # first time only
    ./sync-web.sh               # stage the app into www/
    npx cap sync android
    cd android && ./gradlew assembleDebug

The APK lands in `android/app/build/outputs/apk/debug/`.

`android/local.properties` is gitignored because it hardcodes a path to one
machine's SDK; Android Studio or Gradle will generate yours.

---

## Publishing the website

The site is served by GitHub Pages from the `docs/` folder on `main`:

**Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**

Re-run `./build-site.sh` and commit whenever the app changes, or the published
copy under `docs/app/` goes stale.

---

## Adding your own launch artwork

`assets/welcome/` is empty, so the app opens on artwork generated in code. Drop
`.png`, `.jpg`, `.webp` or `.gif` files in and re-run `./build-site.sh` — it
rebuilds the manifest, which is how the app knows what is there (a browser
cannot list a directory). One is picked at random each launch.

---

## Licence

Not yet chosen. Until one is added, default copyright applies: the source is
readable here but not licensed for reuse.
