# OM × ECHEM Video Generator

Browser-based tool for converting time-ordered optical microscopy (OM) images into WebM videos, with optional synchronized electrochemical (ECHEM/GCPL) curves.

Current version: **v1.28.0** (2026-09-25)

## Quick start

1. Keep the HTML and all three JavaScript runtime files in the same directory.
2. Open `index.html` or `om_echem_video_web_v1.28.0.html` in a current Chromium-based browser. Both HTML files contain the same application.
3. Select OM images. The trailing number in each filename is interpreted as elapsed minutes, so `OM_frame_23.jpg` means 23 min.
4. Optionally select a GCPL TXT/CSV file and verify its time unit or manually enter column names if automatic detection fails.
5. Choose the output mode and generate the video.

No build step or server is required. Internet access is needed at first load for Google Fonts and Papa Parse from their CDNs.

## Main features

- Image-only time-lapse or OM + ECHEM synchronized video
- Automatic image sorting by trailing filename number
- Automatic detection of time, voltage, and current columns
- Numeric time and instrument date-time parsing
- Traditional Chinese and English interface
- Independent OM and ECHEM time offsets
- Fit/fill image layout, sample annotation, and optional time label
- Contrast and brightness adjustment with slider and two-decimal numeric input
- Optional 2× high-quality interpolated output
- Absolute difference from the first image with adjustable gain
- Independent scale-bar overlay excluded from image subtraction
- Translation-only alignment of all frames to the first image using a configurable fixed ROI
- Alignment-check preview with X/Y shift and similarity score
- Configurable scale-bar position and color
- Automatic blue scale-bar detection from the first image
- Manual two-endpoint scale calibration directly in the built-in preview
- Drag-to-select Zoom ROI inset for original and difference videos
- Source-resolution ROI resampling with alignment-aware tracking
- ROI rendering switch: exact main-image match or source-resolution detail
- Optional calibrated ROI scale bar with automatic equivalent-length selection
- Separate scale-bar value and unit controls (nm, µm, mm, cm)
- Multiple ROI selection with automatic right-side grid layout
- Optional compact ECHEM chart occupying one grid cell
- Aspect-ratio-preserving ROI rendering with individual calibrated scale bars
- Li optical-change coverage (%) analysis versus time with CSV export
- Live analysis-region area in source pixels or calibrated units; equivalent diameter controls selection size independently from the electrode area
- Connected-component noise filtering and optional calibrated physical-area export
- Distinct colors for ROI 1–6 across source boxes, grid cells, and analysis curves
- V/I-versus-time chart with numeric voltage and current axes
- Live color-coded coverage percentages beneath the time label on the main image
- Adjustable font size for main-image labels, with ROI coverage in each corresponding zoom frame
- Dropdown navigation for alignment, scale bar, zoom, and coverage settings
- User-selected rectangular or circular local coverage-analysis region
- Move and resize existing Zoom ROIs and the coverage analysis region directly on the image preview
- Semi-transparent coverage mask overlay with adjustable color and opacity
- Circular-electrode area calculation (0.9 cm default) and trapezoidal ECHEM-current integration
- Coverage plots versus time, signed areal capacity, or cumulative absolute charge throughput
- CSV export of synchronized time, capacities, coverage, and calibrated optical-change area
- Original-only, difference-only, or two-video output
- Timeline preview, cancellation, duplicate-time warning, and duration estimate
- Full-width low-latency preview scrubber with bounded image caching and nearby-frame preloading
- Independent Original and Difference from first preview tabs
- Artifact-safe neutral 1× path that bypasses filters and interpolation

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | GitHub Pages entry, identical to the versioned HTML |
| `om_echem_video_web_v1.28.0.html` | Interface, styles, inputs, and embedded changelog |
| `echem_v1.28.0.js` | ECHEM parsing, column detection, time conversion, and chart rendering |
| `fixed-video_v1.28.0.js` | Fixed timeline, WebCodecs encoding, and WebM writing |
| `om-video_v1.28.0.js` | Artifact-safe tabbed preview, adjustments, interpolation, synchronization, difference rendering, recording, and downloads |
| `AGENTS.md` | Instructions and constraints for Codex contributors |
| `CHANGELOG.md` | Release history |
| `LICENSE` | Noncommercial-use terms |
| `LICENSE-v1.28.0.txt` | Original license notice from the recovered v1.28.0 distribution |
| `tests/smoke-test.mjs` | Dependency-free structural and syntax checks |

## Test

With Node.js 18 or later:

```bash
npm test
```

Then perform the manual checks in `TESTING.md`, because browser file selection, Canvas, and WebCodecs cannot be fully validated by the smoke test.

## Known constraints

- FPS can be set from 1 to 120. It defines the nominal cadence; extra image-boundary frames preserve every input image.
- Video duration equals successfully loaded image count × display time per image, at 1 ms WebM precision, without a final-frame hold.
- Higher FPS does not add intermediate experimental images; unchanged source images remain still.

- Video generation requires Canvas and WebCodecs VP9/VP8 support in current Chrome or Edge.
- The current export format is WebM; Safari compatibility may vary.
- Images without trailing filename digits are skipped.
- Difference signals can also arise from motion, focus, illumination, or exposure changes; they are not automatically proof of a material reaction.
- Interpolation adds calculated pixels and smoother enlargement, but cannot recover experimental detail absent from the source image.
- A scale bar is a visual overlay. Its entered pixel length must be calibrated by the user.

## Author

Kuo-Feng King  
University of Houston — Yan Yao & Lihong Zhao Laboratory  
Contact: josh622443@gmail.com / kking20@cougarnet.uh.edu

## Citation and license

If you use this software in research, a presentation, or a publication, cite this repository using GitHub's **Cite this repository** button. A related manuscript is in preparation. See `CITATION.md` and `CITATION.cff`.

The original repository's **PolyForm Noncommercial License 1.0.0** is retained in `LICENSE`. The recovered v1.28.0 distribution's original noncommercial notice is preserved in `LICENSE-v1.28.0.txt`. Commercial use requires prior written permission from Kuo-Feng King; contact kking20@cougarnet.uh.edu.


## v1.9.5 固定時間軸 / Fixed timeline

使用新版 Chrome 或 Edge 開啟同資料夾的 `om_echem_video_web_v1.28.0.html`。請保留所有 JS 檔案。
影片長度 = 成功載入的圖片數 × 每張顯示秒數；兩種輸出共用相同圖片清單。
FPS 控制一般影格間隔；圖片切換時會加入精確邊界影格（可變影格率），避免跳過圖片或改變每張停留時間。
WebM 時間精度為 1 毫秒。計算或讀圖耗時不會加進影片，結尾也不再額外停留。
瀏覽器若不支援 WebCodecs VP9/VP8，會顯示錯誤，不會退回時間不準的錄影。
影片仍在瀏覽器本機處理；沒有上傳。ECHEM CSV 解析仍使用原有 Papa Parse CDN。

Open the HTML in current Chrome/Edge, keeping all JS files alongside it. Duration equals valid image count times display time. Both modes share the validated sequence. Nominal FPS ticks are supplemented by image-boundary frames, giving variable frame rate and preserving every image's display time (WebM precision: 1 ms). Processing delays do not affect duration. Unsupported browsers fail clearly rather than reverting to real-time recording.

## v1.9.4 影片長度計算器 / Duration calculator

「每張圖片顯示時間」右側會即時顯示每支影片的預估長度與計算式。變更圖片、顯示時間、語言或按下重設時都會更新。預估值以已選取且檔名有效的圖片數計算；若個別圖片在輸出時無法解碼，實際長度可能較短。

The calculator beside “Display time per image” shows the estimated duration per output video and its formula. It updates when images, display time, language, or reset changes. The estimate uses selected images with valid filenames; unreadable images excluded during export can make the final duration shorter.
