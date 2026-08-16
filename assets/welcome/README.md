# Welcome images

todo: drop pixel art in this folder. The app picks one at random each launch and
shows it full screen until a section is chosen.

- Any format the WebView can decode: `.png`, `.jpg`, `.webp`, `.gif`.
- Portrait suits the phone screen best; images are cropped to fill, so keep
  anything important away from the edges.
- Run `../../sync-web.sh` after adding files. It rebuilds `manifest.json`,
  which is how the app knows what is here — a WebView cannot list a folder.

With this folder empty the app falls back to artwork generated in code, so it
always has something to open with.
