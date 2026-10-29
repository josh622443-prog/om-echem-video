# v1.28.0 — 2026-09-25

- Use J/L to preview the previous/next image without touching the slider.
- Move the selected zoom ROI or coverage analysis region with arrow keys, one source-image pixel per press or ten pixels with Shift.
- Invalidate stale coverage results after moving a region; preserve the existing region dimensions and stop at image edges.

# v1.27.0 — 2026-09-25

- Add Q/A shortcuts for previous/next page in the left settings menu, with a visible Chinese/English hint.
- Ignore shortcuts while editing fields, using other dropdowns, or viewing the version dialog; stop at the first and last page.

# v1.26.0 — 2026-09-24

- Replace the long left-side stack of settings with an always-visible page selector for inputs, ECHEM, image settings, alignment, scale, Zoom ROI, Li Coverage, and output.
- Keep controls and values in place; switching pages scrolls the settings pane to the top without scrolling past unrelated controls.

# v1.25.0 — 2026-09-24

- Show the complete, current Avrami-type equation below the coverage chart, including fitted parameters, time range, and RMSE.
- Copy the equation with one click; clear stale equations when the analysis, ROI, or fit range changes.

# v1.24.0 — 2026-09-24

- Overlay a dashed Avrami fit of local-main-image coverage on the coverage chart.
- Choose the fitting end time (default 800 min); report the fitted exponent and RMSE on the plot without drawing the fitted curve beyond the fit range.

# v1.23.0 — 2026-09-24

- Append actual coverage-analysis settings to each exported CSV row: threshold, minimum connected area, electrode diameter and area, image offset, alignment, image dimensions, scale calibration, and analysis-region and ROI coordinates.
- Snapshot settings when coverage analysis runs, so subsequent UI changes cannot mislabel the CSV.

# v1.22.0 — 2026-09-24

- Use the selected image folder name as the generated video filename.
- Add editable output filename for direct multi-file selection while retaining original and difference suffixes.

# v1.21.1 — 2026-09-24

- Show numeric X-axis tick labels for all Li coverage chart modes.

# v1.21.0 — 2026-09-24

- Show selected coverage analysis area in source pixels and calibrated physical units.
- Resize the selected region by entering its equivalent-area diameter in pixels or physical units, preserving shape and center.
- Keep electrode diameter independent from the coverage selection.

# v1.20.0 — 2026-09-24

- Add adjustable main-image label font size for both preview and video.
- Replace the left settings tabs with a dropdown selector.
- Draw each ROI coverage in the upper-left corner of its own zoom frame; retain only local main-image coverage in the main label stack.

# v1.19.0 — 2026-09-24

- Edit existing Zoom ROIs or the coverage analysis region directly on the preview image.
- Drag inside a region to move it; drag its corner handles to resize it within image bounds.
- Invalidate previous coverage values and mask when a region changes so analysis can be rerun.

# v1.18.0 — 2026-09-23

- Add a separately selected rectangular or circular coverage analysis region.
- Restrict the coverage denominator, changed area, and mask to valid pixels inside that region.
- Always report local-main-image coverage alongside any Zoom ROI coverage.
- Overlay an adjustable-color, adjustable-opacity coverage mask on preview and output video.
- Keep the 0.9 cm electrode diameter exclusively for electrochemical areal-capacity normalization.

# v1.17.0 — 2026-09-23

- Move live coverage percentages to the upper-left image overlay directly below time.
- Match each ROI coverage label to its ROI border color.
- Remove the coverage subplot from the V–I–t chart while retaining the standalone analysis chart and CSV export.

# v1.16.0 — 2026-09-23

- Add circular-electrode diameter input and automatic area calculation (0.9 cm → 0.6362 cm²).
- Integrate ECHEM current by the trapezoidal rule and normalize by electrode area.
- Preserve both signed areal capacity and non-cancelling absolute charge throughput.
- Allow the coverage chart X axis to switch among time, signed capacity, and throughput.
- Export synchronized time, capacity, throughput, coverage, and calibrated optical area to CSV.

# v1.15.1 — 2026-09-23

- Add analyzed coverage curves as a synchronized subplot beneath voltage/current versus time.
- Show a shared moving time cursor across the electrochemical and coverage plots.
- Add missing numeric tick labels to the right-side current axis.
- Preserve distinct Multi-ROI colors in the synchronized coverage subplot.

# v1.15.0 — 2026-09-23

- Add first-frame-referenced optical-change coverage analysis for the full image or multiple ROIs.
- Add adjustable difference threshold and minimum connected-area filtering.
- Plot coverage percentage versus image time and export the results as CSV.
- Export calibrated physical area when source scale-bar calibration is available.
- Assign distinct, consistent colors to ROI boxes, right-panel cells, and coverage curves.

# v1.14.0 — 2026-09-23

- Add multiple drag-selected Zoom ROIs.
- Add an automatic right-side grid containing ROI views and an optional compact ECHEM chart cell.
- Preserve each ROI's source aspect ratio to prevent horizontal or vertical stretching.
- Add remove-last and clear-all ROI controls while preserving the original single-overlay mode.

# v1.13.1 — 2026-09-23

- Replace the free-text scale label with separate numeric value and unit controls.
- Add explicit nm, µm, mm, and cm unit options.
- Preserve the selected unit when an equivalent shorter ROI scale bar is generated.

# v1.13.0 — 2026-09-23

- Add an optional calibrated scale bar inside the Zoom ROI inset.
- Scale the ROI bar using the effective inset magnification, including automatic inset-size limiting.
- Automatically choose a shorter equivalent physical scale when the full calibrated bar does not fit.

# v1.12.1 — 2026-09-23

- Add Match main image and Source-resolution detail ROI rendering modes.
- Make Match main image the default so ROI brightness, contrast, color, and difference noise match the main panel.
- Preserve the source-resolution path as an optional morphology-inspection mode.

# v1.12.0 — 2026-09-23

- Add a Zoom ROI settings tab with drag-to-select interaction in the first-frame preview.
- Resample the inset directly from each source image for original and difference modes.
- Track the same fixed ROI when translation alignment is enabled.
- Add magnification, inset position, border color, and optional source-box controls.

# v1.11.0 — 2026-09-22

- Add automatic blue scale-bar detection and manual two-endpoint calibration in preview.

# v1.10.0 — 2026-09-21

- Add image alignment, an alignment-check preview, and scale-bar position/color controls.

# v1.9.5 — 2026-09-15

- Add deterministic fixed-timeline WebCodecs encoding and browser regression coverage.

# v1.9.4 — 2026-09-15

- Use WebCodecs and explicit timestamps instead of real-time recording.
- Validate the source sequence once for both outputs.
- Preserve exact image boundaries, remove processing delays and the extra tail hold.
- Bundle a local WebM writer; no new network dependency.
- Require WebCodecs-capable Chrome/Edge; no timing-unsafe fallback.

# Changelog

## 1.9.3 — 2026-09-15

- Lowered display time per image to 0.01 seconds, with 0.01-second increments.

## 1.9.2 — 2026-09-15

- Raised the requested capture FPS limit to 120 and enforced the 1–120 range.
- Kept display duration per image independent of FPS.

## 1.9.1 — 2026-09-14

- Fixed grid artifacts that could appear in the neutral 1× rendering path.
- Completely bypassed browser image filters when contrast and brightness are both 100%.
- Limited high-quality interpolation to 2× output; all other behavior remains unchanged.

## 1.9.0 — 2026-09-14

- Added Original and Difference from first tabs above the composed-frame preview.
- Made preview mode independent from the selected video output mode.
- Preserved the current time, contrast, brightness, interpolation, and annotation settings while switching tabs.

## 1.8.1 — 2026-09-14

- Extended the preview-time scrubber to the full preview width.
- Added a bounded decoded-image cache and adjacent-frame preloading.
- Coalesced rapid drag events and ignored stale asynchronous preview results.

## 1.8.0 — 2026-09-14

- Moved the preview-time scrubber directly below the composed-video preview.
- Added synchronized contrast and brightness sliders plus two-decimal numeric inputs.
- Added optional 2× high-quality interpolated video output.

## 1.7.1 — 2026-09-12

- Moved the preview-image slider below video output and progress information.

## 1.7.0 — 2026-09-12

- Added original + difference dual-video output.
- One generation action creates two videos with separate download buttons.
- Retained original-only and difference-only modes.

## 1.6.0 — 2026-09-12

- Added automatic instrument date-time parsing and elapsed-time conversion.
- Improved scientific notation, Unicode minus, and text-number parsing.

## 1.5.0 — 2026-09-12

- Added an independent scale-bar overlay excluded from image subtraction.
- Added editable label, display length, and thickness.

## 1.4.0 — 2026-09-12

- Added absolute-difference mode relative to the first image.
- Added adjustable 1×–20× difference gain.

## 1.3.0 — 2026-09-12

- Added timeline preview, OM/ECHEM offsets, Fit/Fill, annotations, cancellation, duration estimation, and duplicate-time checks.

## 1.2.0 — 2026-09-12

- Added Traditional Chinese and English interface switching.

## 1.1.0 — 2026-09-12

- Added image-only mode and display duration per image.
- Made ECHEM input optional.

## 1.0.0 — 2026-08-24

- Split the application into HTML, ECHEM, and OM/video modules.
- Added semantic-versioned filenames and an embedded changelog.
