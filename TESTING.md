# Manual test checklist

Use a current Chromium-based browser and open the HTML file directly.

## v1.28.0 layout and labels

- Switch all four settings sections using the left dropdown, including after changing language.
- Adjust label font size and confirm time, local coverage, voltage, and current change in preview and both exported videos.
- With multiple Zoom ROIs, confirm each percentage appears in the matching colored zoom frame and follows preview time.
- Confirm the main image lists local coverage once, with no ROI 1–3 coverage stacked beneath it.
- Check both single inset and multi-ROI grid layouts and the optional original ROI source boxes.

## Loading and sorting

- Select images whose names end in non-sequential numbers and confirm the displayed time range and playback order are numerical.
- Include one image without trailing digits and confirm it is skipped with a warning.
- Confirm image-only mode becomes ready without an ECHEM file.

## ECHEM

- Load comma-, tab-, and semicolon-delimited samples when available.
- Confirm automatic detection for `time`, `Ewe/V`, and `I/mA`-style headers.
- Test numeric time in seconds, minutes, and hours.
- Test an instrument timestamp such as `09/11/2026 22:00:42.3394`.
- Confirm manual column-name override works when detection fails.

## Composition

- Check Fit and Fill modes.
- Confirm contrast and brightness sliders update their numeric fields to two decimals.
- Confirm typing valid decimal values updates the matching sliders and preview.
- Confirm the same adjustments appear in preview, original output, and difference output.
- Compare neutral 1× original output against v1.7 using the same source frame and output height; confirm no processing-induced grid pattern appears.
- Generate at 1× and 2× and confirm 2× doubles both encoded width and height.
- Check OM and ECHEM offsets at zero and nonzero values.
- Check Traditional Chinese and English.
- Check sample annotation and time-label visibility.
- Check the timeline scrubber below the composed preview at the first, middle, and last image.
- Drag the full-width scrubber quickly in both directions and confirm old asynchronous loads never replace the latest selected frame.
- Revisit nearby frames and confirm cached previews respond without repeated decoding delay.
- Switch between Original and Difference from first preview tabs and confirm the output-mode selector does not change.
- Confirm time, contrast, brightness, interpolation, and annotation settings remain active across preview tabs.

## Difference and scale bar

- Confirm the first difference frame is black except for overlays.
- Confirm difference gain changes visibility without modifying the original output.
- Confirm the scale bar appears in the same place in original and difference videos and is not subtracted from the baseline.
- Open the Alignment & Scale section and switch between both settings tabs.
- Enable alignment, select a fixed textured ROI, and confirm Alignment check reports X/Y shift and similarity score.
- Confirm a synthetically translated frame is shifted back toward the first frame in original and difference previews.
- Confirm low-confidence alignment retains the original position and reports a warning.
- Confirm scale-bar color and all four positions work and remain outside alignment/difference calculations.
- On a first image with a blue lower-right scale bar, run automatic detection and verify the highlighted endpoints match the original bar.
- Change output height and confirm the calibrated scale-bar length changes proportionally.
- Use manual endpoint picking and confirm the displayed source/output pixel lengths match the two selected points.
- In Zoom ROI, drag a rectangle over the first-frame preview and confirm source-pixel dimensions are reported.
- Confirm the inset appears in original and difference previews and in both generated videos.
- Change magnification, all four inset positions, border color, and source-box visibility.
- With alignment enabled, confirm the inset tracks the same fixed feature rather than the drifting source coordinates.
- In Match main image mode, confirm ROI brightness, contrast, color, and difference noise match the source box exactly.
- In Source-resolution detail mode, confirm extra source detail is visible and the inset is labeled SOURCE.

## Recording

- Generate original-only, difference-only, and original + difference outputs.
- In two-video mode, confirm two independent download entries appear.
- Play each WebM file and confirm duration, frame order, annotations, curves, and cursor synchronization.
- Cancel a long generation and confirm the interface returns to a usable state.


## v1.28.0 regression tests

- Select multiple Zoom ROIs and drag each region body on the main image; confirm its inset and output position update.
- Drag all four corners and check minimum size and image-edge clamping.
- Move and resize a circular coverage region; confirm its mask and percentage disappear until analysis is rerun.
- Switch between Zoom ROI editing and Coverage region editing, including overlapping regions.
- Verify the edit outlines appear in preview only and generation uses the edited geometry.

## v1.18.0 regression tests

- Select rectangular and circular analysis regions and verify only interior pixels enter the denominator.
- Confirm analysis is blocked until a coverage analysis region is selected.
- Confirm Local main image coverage is always present and Zoom ROI coverage remains available.
- Toggle the main-image mask and verify color/opacity changes update the preview and output.
- Verify the electrode diameter changes capacity normalization but does not relocate or resize the optical analysis region.

## v1.17.0 regression tests

- Run coverage analysis and verify each current ROI percentage appears below the upper-left time label.
- Confirm ROI coverage text colors match the ROI borders.
- Confirm the V–I–t chart no longer contains a coverage subplot.
- Scrub the preview and verify overlay values follow the selected image.

## v1.16.0 regression tests

- Verify the default 0.90 cm diameter reports 0.6362 cm².
- Load ECHEM current and confirm signed capacity and absolute throughput are present in the CSV.
- Switch the coverage X axis among time, signed capacity, and cumulative throughput.
- Confirm signed capacity may reverse with current polarity while absolute throughput remains nondecreasing.
- Confirm image-only analysis falls back to time without inventing capacity values.

## v1.15.1 regression tests

- Run coverage analysis with ECHEM loaded and verify coverage appears beneath the V/I plot.
- Confirm the red time cursor spans both electrochemical and coverage subplots.
- Confirm the right current axis displays numeric tick values in mA.
- Verify Multi-ROI coverage colors remain consistent with ROI boxes and cells.

- Analyze an unchanged sequence and verify coverage remains near zero at an appropriate threshold.
- Analyze a sequence with a known changed patch and verify full-image and Multi-ROI coverage percentages.
- Increase minimum connected area and confirm isolated noise is removed.
- Calibrate the source scale bar and confirm CSV includes physical area in the selected squared unit.
- Confirm ROI colors match source boxes, right-panel cells, and coverage curves.

- Select right-side grid mode, add 1–6 ROIs, and verify add/remove-last/clear-all behavior.
- Confirm every ROI preserves its source aspect ratio and its scale bar remains physically consistent.
- Load ECHEM data and verify the chart occupies one grid cell while all ROI cells remain visible.
- Verify preview, original export, and difference export use the same grid ordering and dimensions.

- Calibrate or enter a known main scale bar, enable Zoom ROI, and confirm the inset scale represents the same physical calibration.
- Shrink the ROI inset or raise magnification and confirm a shorter equivalent label is selected instead of clipping the bar.
- Verify the ROI scale bar appears identically in preview and final original/difference videos and remains outside the difference calculation.

Run `npm test` (or run `node tests/smoke-test.mjs` and `node tests/timeline-test.mjs` directly). Serve the release folder locally (for example `python -m http.server 8000 --bind 127.0.0.1`) and open `http://127.0.0.1:8000/tests/browser-test.html` in Chrome/Edge to run synthetic image tests. The harness uses a same-origin iframe, so it must be served over localhost. The existing Papa Parse CDN must load for the ECHEM case. No research images are needed.

Verified in Chromium browser on 2026-09-15:
- 12 images × 0.13 s at nominal 30 FPS: both modes 1.560 s, 57 frames, identical timestamp sequence despite injected unequal processing delays.
- 12 images × 0.01 s at nominal 8 FPS: 0.120 s, all 12 images retained.
- 12 images × 0.35 s with ECHEM, 2× output, scale bar: both modes 4.200 s, 1264 × 480, 43 frames; seeking across keyframe clusters works.
- Cancellation returns UI to usable state; subsequent export succeeds.
- Missing WebCodecs yields a clear error with no partial download.
- Exported WebM files were independently decoded with OpenCV; first/last frames visually inspected.

This release changes FPS to a nominal cadence with additional image-boundary frames, preserving exact display time instead of dropping fast images. Timing is independent of rendering load.

Validation limitation: browser execution was tested over localhost. Direct file navigation was blocked by the automated browser policy; direct-file launch must be checked manually. Runtime scripts remain classic relative scripts with no module fetches or added remote dependencies. `npm` was unavailable on the test host; both commands in the npm test script were executed directly with Node and passed.
