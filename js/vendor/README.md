# Vendored dependencies

Committed rather than fetched at runtime, so the packaged Android app makes no
network requests.

## mp4-muxer.mjs

- Source: https://github.com/Vanilagy/mp4-muxer (npm `mp4-muxer@5.2.1`)
- Build: `build/mp4-muxer.mjs`, taken from jsDelivr
- Licence: MIT

Used by `js/encode.js` to wrap H.264 chunks from `VideoEncoder` into an MP4
container. WebCodecs produces encoded chunks but has no muxer of its own, so
something has to write the container.
