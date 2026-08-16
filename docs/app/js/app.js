// app.js — start-up.

import * as shell from './shell.js';
import * as settings from './settings.js';
import * as palettes from './palettes.js';
import * as extractui from './extractui.js';
import * as photo from './photo.js';
import * as video from './video.js';

function main() {
    settings.init();
    // The shell subscribes to palette changes to keep its preview current, and
    // so do photo and video for their dropdowns — all of them must be wired up
    // before palettes.init() publishes the first set.
    shell.init();
    photo.init();
    video.init();
    extractui.init();
    palettes.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
