# Codex project instructions

## Scope

## GitHub synchronization

The user has authorized automatic commits and uploads after each completed update and applicable validation to `josh622443-prog/om-echem-video`, branch `main`. Do not ask again for routine uploads. Preserve remote history, original license and citation notices, and unrelated files; do not force-push. Include only task-related code, documentation, and synthetic tests, never selected research data or credentials. Verify the remote head after upload and report its commit. Keep `index.html` identical to the versioned release HTML.

## Tool scope

Maintain the browser-only OM × ECHEM Video Generator. Do not add a backend, upload research data, or introduce telemetry unless the user explicitly requests it.

## Architecture

- HTML owns the UI shell, CSS, input elements, and embedded changelog.
- `echem_v1.28.0.js` must remain DOM-independent and expose `window.EchemModule`.
- `om-video_v1.28.0.js` owns DOM binding, artifact-safe image processing, tabbed cached preview, synchronization, Canvas composition, fixed-timeline encoding, and download management.
- Papa Parse is provided as global `window.Papa` by the HTML CDN script.

## Versioning

Use semantic versioning. For a release, update all versioned runtime filenames and every internal reference together:

1. HTML filename, title, version badge, and script `src` values.
2. Both JavaScript filenames and header comments.
3. Embedded `changelogData`, `CHANGELOG.md`, and `package.json`.

Never deliver a release whose HTML points to JavaScript files from another version.

## Compatibility and behavior

- Preserve Traditional Chinese and English UI strings for all user-visible features.
- Preserve image-only operation; ECHEM must remain optional.
- Preserve automatic numeric ordering based on trailing filename digits.
- Keep the scale-bar overlay outside the image-difference calculation.
- Apply contrast and brightness consistently to preview and final output. Keep their slider and numeric controls synchronized to two decimals.
- Treat 2× interpolation as calculated upscaling, not recovery of missing microscope detail.
- Keep preview caching bounded and prevent stale asynchronous image loads from overwriting the latest slider position.
- Keep preview-tab selection independent from final output-mode selection.
- At neutral 100% contrast, 100% brightness, and 1× output, bypass Canvas filters and explicit high-quality interpolation to preserve the v1.7 rendering path.
- Treat difference mode as absolute per-channel pixel difference relative to the first image; document that experimental artifacts can create signal.
- Do not send selected files or generated video outside the browser.
- Avoid unnecessary dependencies and keep direct-file opening supported.

## Validation

Run `npm test`, then follow `TESTING.md`. For changes to rendering or recording, browser validation is mandatory.

## Licensing

This project is not open source under an OSI-approved license. Preserve the noncommercial restriction in `LICENSE`; do not replace it with MIT, Apache-2.0, BSD, or GPL without explicit author approval.

- `fixed-video_v1.28.0.js` owns deterministic frame timing, WebCodecs encoding, and the bundled WebM writer. Version its filename and HTML reference together.
