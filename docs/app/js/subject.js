// subject.js — the image the Palettes screen previews against.
//
// Palettes are judged by what they do to a picture. Photo and Extract publish
// here when they decode a file, so the Palettes screen can show the effect of a
// palette on the thing the user is actually working on.
//
// The default is the welcome art, which keeps everything downstream simple: the
// subject is never null. `hasUserSubject()` distinguishes it from something the
// user chose, because a preview of the stock artwork is not worth screen space.

import { pixelArt } from './welcome.js';

let subject = null;
let userProvided = false;
const listeners = new Set();

export const onSubjectChanged = (fn) => listeners.add(fn);

/** True once the user has loaded media of their own. */
export const hasUserSubject = () => userProvided;

/** The welcome art, built on first use so start-up stays cheap. */
export function getSubject() {
    if (!subject) subject = pixelArt();
    return subject;
}

export function setSubject(imageData) {
    if (!imageData) return;
    subject = imageData;
    userProvided = true;
    listeners.forEach((fn) => fn(subject));
}
