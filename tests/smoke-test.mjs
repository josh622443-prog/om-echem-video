import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const version = "1.28.0";
const htmlName = `om_echem_video_web_v${version}.html`;
const echemName = `echem_v${version}.js`;
const videoName = `om-video_v${version}.js`;

const [html, echem, video] = await Promise.all([
  readFile(new URL(`../${htmlName}`, import.meta.url), "utf8"),
  readFile(new URL(`../${echemName}`, import.meta.url), "utf8"),
  readFile(new URL(`../${videoName}`, import.meta.url), "utf8"),
]);

assert.match(html, new RegExp(`v${version.replaceAll(".", "\\.")}`));
assert.ok(html.includes(`<script src="${echemName}"></script>`));
assert.ok(html.includes(`<script src="${videoName}"></script>`));
assert.ok(html.includes('id="visualMode"'));
for(const page of ['input','fields','compose','tools','output']){
  assert.ok(html.includes(`data-workflow-panel="${page}"`),`Missing compact workflow page: ${page}`);
}
assert.ok(html.includes('id="workflowSection"')&&video.includes('function showWorkflowSection(section)'), 'Missing page navigation');
assert.match(html, /id="fps"[^>]*max="120"/);
assert.match(html, /id="frameDuration"[^>]*min="0.01"[^>]*step="0.01"/);
assert.ok(html.includes('id="durationEstimate"'));
assert.ok(html.includes('id="durationFormula"'));
assert.ok(!video.includes('Math.max(0.1, parseFloat($("frameDuration")'));
assert.ok(video.includes("Math.min(120, Math.max(1"));
assert.ok(html.includes('value="both"'));
assert.ok(html.includes('id="showScaleBar"'));
assert.ok(html.includes('id="contrastRange"'));
assert.ok(html.includes('id="contrastValue"'));
assert.ok(html.includes('id="brightnessRange"'));
assert.ok(html.includes('id="brightnessValue"'));
assert.ok(html.includes('id="upscaleFactor"'));
assert.ok(html.includes('data-preview-mode="original"'));
assert.ok(html.includes('data-preview-mode="difference"'));
assert.ok(echem.includes("window.EchemModule"));
assert.ok(video.includes('outputModes = selectedOutputMode === "both"'));
assert.ok(video.includes("Math.abs(current.data"));
assert.ok(video.includes("imageSmoothingQuality = \"high\""));
assert.ok(video.includes("contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)"));
assert.ok(video.includes("Math.abs(cfg.contrast - 100) > 0.001"));
assert.ok(video.includes("cfg.upscaleFactor > 1"));
assert.ok(video.includes("const imageCache = new Map()"));
assert.ok(video.includes("requestAnimationFrame"));
assert.ok(video.includes("requestId !== previewRequestId"));
assert.ok(video.includes("preloadAround(idx)"));
assert.ok(video.includes('let previewVisualMode = "original"'));
assert.ok(video.includes('previewVisualMode === "difference"'));
assert.ok(video.includes("FixedVideo.create"));
assert.ok(video.includes("function updateDurationEstimate()"));
assert.ok(video.includes('$("frameDuration").addEventListener("input", updateDurationEstimate)'));
assert.ok(!video.includes("captureStream("));

new Function(echem);
new Function(video);

console.log(`Smoke test passed for OM × ECHEM Video Generator v${version}.`);

const fixed = await readFile(new URL('../fixed-video_v1.28.0.js', import.meta.url), 'utf8');
assert.ok(html.includes('<script src="fixed-video_v1.28.0.js"></script>'));
for (const id of ['alignEnabled','maxShift','roiX','roiY','roiW','roiH','alignmentReadout','scalePosition','scaleColor']) {
  assert.ok(html.includes(`id="${id}"`), `Missing alignment/scale control: ${id}`);
}
for (const id of ['detectBlueScale','pickScaleEndpoints','scaleCalibrationStatus']) {
  assert.ok(html.includes(`id="${id}"`), `Missing integrated scale calibration control: ${id}`);
}
for (const id of ['scaleValue','scaleUnit']) {
  assert.ok(html.includes(`id="${id}"`), `Missing structured scale-bar value/unit control: ${id}`);
}
assert.ok(!html.includes('id="scaleLabel"'), 'Legacy free-text scale label should be replaced');
assert.ok(video.includes('detectBlueScaleBar'), 'Missing automatic blue scale-bar detection');
assert.ok(video.includes('beginScaleEndpointPicking'), 'Missing manual endpoint calibration');
for (const id of ['roiZoomEnabled','selectZoomRoi','zoomRoiStatus','roiMagnification','roiInsetPosition','roiBorderColor','showRoiSourceBox','showRoiScaleBar']) {
  assert.ok(html.includes(`id="${id}"`), `Missing Zoom ROI control: ${id}`);
}
for (const id of ['roiLayoutMode','removeLastZoomRoi','clearZoomRois']) {
  assert.ok(html.includes(`id="${id}"`), `Missing multi-ROI control: ${id}`);
}
assert.ok(html.includes('id="roiRenderMode"'), 'Missing ROI rendering-mode selector');
assert.ok(video.includes('cfg.roiRenderMode === "match"'), 'Missing main-image matching ROI path');
assert.ok(video.includes('beginZoomRoiPicking'), 'Missing drag-to-select Zoom ROI interaction');
assert.ok(video.includes('renderZoomRoi'), 'Missing Zoom ROI renderer');
assert.ok(video.includes('drawRoiScaleBar'), 'Missing calibrated Zoom ROI scale-bar renderer');
assert.ok(video.includes('effectiveMagnification'), 'ROI scale bar must account for inset size limiting');
assert.ok(video.includes('getRightPanelLayout'), 'Missing automatic right-side grid layout');
assert.ok(video.includes('renderRoiGridCell'), 'Missing multi-ROI grid renderer');
assert.ok(video.includes('renderRightPanel'), 'Missing shared ECHEM/ROI right-panel renderer');
for (const id of ['coverageRegionShape','selectCoverageRegion','clearCoverageRegion','coverageRegionStatus','showCoverageMask','coverageMaskColor','coverageMaskOpacity','coverageThreshold','coverageMinArea','electrodeDiameterCm','electrodeAreaReadout','coverageXAxis','runCoverageAnalysis','downloadCoverageCsv','coverageChart']) {
  assert.ok(html.includes(`id="${id}"`), `Missing Li coverage control: ${id}`);
}
assert.ok(video.includes('filteredDifferenceMask'), 'Missing connected-component coverage filter');
assert.ok(video.includes('runCoverageAnalysis'), 'Missing Li coverage analysis workflow');
assert.ok(video.includes('integrateCapacity'), 'Missing trapezoidal current integration');
assert.ok(video.includes('signed_areal_capacity_mAh_cm2'), 'CSV lacks signed areal capacity');
assert.ok(video.includes('absolute_throughput_mAh_cm2'), 'CSV lacks absolute charge throughput');
assert.ok(video.includes('ROI_COLORS'), 'Missing distinct multi-ROI color palette');
assert.ok(video.includes('roiCoverageAt'), 'Missing per-ROI coverage labels');
assert.ok(video.includes('pointInsideCoverageRegion'), 'Coverage is not restricted to the selected analysis region');
assert.ok(video.includes('drawCoverageMask'), 'Missing main-image coverage mask overlay');
assert.ok(video.includes('encodeMaskRuns'), 'Coverage masks are not stored compactly');
for(const id of ['editZoomRois','editCoverageRegion'])assert.ok(html.includes(`id="${id}"`),`Missing ROI editing control ${id}`);
assert.ok(video.includes('adjustedRegion(') && video.includes('invalidateCoverage();'), 'Region editing must update geometry and invalidate coverage');
assert.ok(video.includes('if(mainCoverage)labels.push(mainCoverage)'), 'Preview does not show local coverage beneath time');
assert.ok(html.includes('id="settingsSection"') && !html.includes('data-settings-tab='), 'Settings must use a dropdown');
assert.ok(html.includes('id="labelFontSize"') && video.includes('drawMainLabels(ctx,topLabels,cfg,imgW,outH)'), 'Main label size must apply to video output');
assert.ok(!video.includes('timesH:coverageResults.rows'), 'Coverage should not be sent to the ECHEM chart');
assert.ok(echem.includes('numeric ticks for the secondary current axis'), 'Current-axis numeric ticks are missing');
assert.ok(html.includes('data-preview-mode="aligned"'), 'Missing alignment preview tab');
assert.ok(video.includes('getAlignmentShift'), 'Missing alignment implementation');
assert.ok(video.includes('alignmentScore'), 'Missing normalized-correlation scoring');
new Function(fixed);
