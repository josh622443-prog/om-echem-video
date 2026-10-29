/*!
 * om-video_v1.28.0.js
 * ------------------------------------------------------------------
 * OM 影片模組：負責顯微鏡圖片與影片合成的所有邏輯——
 *   - 圖片載入（含失敗自動跳過）
 *   - 檔名時間解析（結尾連續數字 = 第幾分鐘）
 *   - 畫面合成（圖片 + 文字標籤 + echem 曲線圖）
 *   - 與 EchemModule 整合（呼叫其 parse / drawChart）
 *   - WebCodecs 錄影與下載清單管理
 *   - 所有 DOM 綁定與畫面狀態（本工具的「主控台」）
 *
 * 相依：window.EchemModule（見 echem.js，需先於本檔案載入）
 * ------------------------------------------------------------------
 */
(function () {
  "use strict";

  const Echem = window.EchemModule;

  // ---------- state ----------
  let imageEntries = []; // [{minute, file}]
  let echemT = [],
    echemV = [],
    echemI = null;
  let echemColsDetected = null;
  let generating = false;
  let cancelRequested = false;
  let downloadUrls = []; // 追蹤已建立的 blob URL，供 reset 時釋放記憶體
  let downloadCounter = 0;
  const imageCache = new Map(); // 最近使用的解碼圖片；避免拖曳預覽時重複解碼
  const IMAGE_CACHE_LIMIT = 24;
  let previewRequestId = 0;
  let previewAnimationFrame = 0;
  let previewVisualMode = "original";
  const alignmentCache = new Map();
  let scalePickActive = false;
  let scalePickPoints = [];
  let detectedScale = null;
  let zoomRoi = null; // compatibility alias for the first ROI
  let zoomRois = []; // normalized to the original OM image: [{x,y,w,h,...}]
  let roiPickActive = false;
  let coverageRegion = null, coveragePickActive = false;
  let roiEditMode = null, selectedEditRegion = null, regionEditDrag = null;
  let roiDragStart = null;
  let roiDragCurrent = null;
  let roiReferenceAspect = 4 / 3;
  let coverageResults = null;
  const ROI_COLORS = ["#57D9C4","#FFB454","#FF6B8A","#77A7FF","#C68CFF","#A8D65E"];
  const roiColor = (index, cfg) => index >= 0 ? ROI_COLORS[index % ROI_COLORS.length] : cfg.roiBorderColor;

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const imgInput = $("imgInput");
  const folderInput = $("folderInput");
  const outputBaseNameInput = $("outputBaseName");
  const echemInput = $("echemInput");
  const imgSummary = $("imgSummary");
  const echemSummary = $("echemSummary");
  const genBtn = $("genBtn");
  const resetBtn = $("resetBtn");
  const progFill = $("progFill");
  const progText = $("progText");
  const logEl = $("log");
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const scopeEmpty = $("scopeEmpty");
  const stageCanvas = $("stageCanvas");
  const readout = $("readout");
  const downloadList = $("downloadList");
  const versionBadge = $("versionBadge");
  const changelogOverlay = $("changelogOverlay");
  const changelogClose = $("changelogClose");
  const changelogBody = $("changelogBody");
  const languageSelect = $("languageSelect");
  const previewBtn = $("previewBtn");
  const previewSlider = $("previewSlider");
  const previewModeTabs = Array.from(document.querySelectorAll("[data-preview-mode]"));
  const cancelBtn = $("cancelBtn");
  const alignmentReadout = $("alignmentReadout");
  const settingsSection = $("settingsSection");
  const workflowSection = $("workflowSection");
  const rail = document.querySelector(".rail");
  const detectBlueScaleBtn = $("detectBlueScale");
  const pickScaleEndpointsBtn = $("pickScaleEndpoints");
  const scaleCalibrationStatus = $("scaleCalibrationStatus");
  const previewScope = stageCanvas.closest(".scope");
  const selectZoomRoiBtn = $("selectZoomRoi");
  const zoomRoiStatus = $("zoomRoiStatus");
  const removeLastZoomRoiBtn = $("removeLastZoomRoi");
  const clearZoomRoisBtn = $("clearZoomRois");
  const runCoverageAnalysisBtn = $("runCoverageAnalysis");
  const downloadCoverageCsvBtn = $("downloadCoverageCsv");
  const coverageStatus = $("coverageStatus");
  const coverageChart = $("coverageChart");
  const coverageOutputPanel = $("coverageOutputPanel");
  const avramiEquation = $("avramiEquation");
  const copyAvramiEquationBtn = $("copyAvramiEquation");
  const avramiEquationStatus = $("avramiEquationStatus");
  const electrodeDiameterCm = $("electrodeDiameterCm");
  const electrodeAreaReadout = $("electrodeAreaReadout");
  const coverageXAxis = $("coverageXAxis");
  const selectCoverageRegionBtn = $("selectCoverageRegion");
  const clearCoverageRegionBtn = $("clearCoverageRegion");
  const coverageRegionStatus = $("coverageRegionStatus");
  const editZoomRoisBtn = $("editZoomRois");
  const editCoverageRegionBtn = $("editCoverageRegion");

  settingsSection.addEventListener("change", () => {
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== settingsSection.value;
    });
    if(workflowSection.value!==settingsSection.value && ["alignment","scale","zoom","coverage"].includes(workflowSection.value)){
      workflowSection.value=settingsSection.value;
    }
  });

  function showWorkflowSection(section){
    const toolPages=["alignment","scale","zoom","coverage"];
    const panel=toolPages.includes(section)?"tools":section;
    document.querySelectorAll("[data-workflow-panel]").forEach(el=>{
      el.hidden=el.dataset.workflowPanel!==panel;
    });
    if(toolPages.includes(section)){
      settingsSection.value=section;
      settingsSection.dispatchEvent(new Event("change"));
    }
    rail.scrollTop=0;
  }
  workflowSection.addEventListener("change",()=>showWorkflowSection(workflowSection.value));

  function workflowShortcutDirection(event,modalOpen){
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||modalOpen)return 0;
    const key=event.key?.toLowerCase();
    if(key!=="q"&&key!=="a")return 0;
    const target=event.target;
    if(target!==workflowSection && target?.closest?.("input, textarea, select, [contenteditable], [role='textbox']"))return 0;
    return key==="q"?-1:1;
  }

  document.addEventListener("keydown",event=>{
    const direction=workflowShortcutDirection(event,$("changelogOverlay").classList.contains("open"));
    if(!direction)return;
    event.preventDefault();
    const options=Array.from(workflowSection.options),current=workflowSection.selectedIndex;
    const next=Math.min(options.length-1,Math.max(0,current+direction));
    if(next===current)return;
    workflowSection.selectedIndex=next;
    workflowSection.dispatchEvent(new Event("change",{bubbles:true}));
    workflowSection.focus({preventScroll:true});
  });

  const coverageRegionDiameterInput = $("coverageRegionDiameter");
  const coverageRegionDiameterUnit = $("coverageRegionDiameterUnit");
  const coverageRegionAreaReadout = $("coverageRegionAreaReadout");
  // ---------- i18n ----------
  const I18N = {
    "zh-TW": {
      appTitle:"同步影片產生器", stepInput:"01 / 輸入", inputHeading:"圖片與電化學資料", imageLabel:"OM 圖片（選取資料夾內所有圖檔）", chooseImages:"📁 選擇圖片檔案…", echemLabel:"GCPL 電化學資料（選填）", chooseEchem:"📄 選擇 txt 檔…", filenameHint:'圖片檔名結尾的連續數字會被當作「第幾分鐘」，例如 <code>OM_frame_23.jpg</code> → 23 分鐘。', stepFields:"02 / 欄位", fieldsHeading:"電化學欄位（僅在上傳 ECHEM 時使用）", timeColumn:"時間欄名稱", voltageColumn:"電壓欄名稱", currentColumn:"電流欄名稱", timeUnit:"時間欄單位", hours:"小時 (h)", minutes:"分鐘 (min)", seconds:"秒 (s)", showCurrent:"同時顯示電流曲線", stepOutput:"03 / 輸出", outputHeading:"影片參數", height:"畫面高度 (px)", duration:"每張圖片顯示時間（秒）", generate:"產生影片", reset:"重設", notStarted:"尚未開始", previewEmpty:'選好檔案並按「產生影片」後，這裡會即時顯示合成畫面', changelog:"版本歷程 / Changelog", statusIdle:"待輸入", statusReadyBoth:"就緒（OM + ECHEM）", statusReadyImage:"就緒（純圖片）", statusBusy:"產生中…", statusDone:"完成", statusError:"發生錯誤", noUsableImages:"沒有找到可用的圖片（檔名結尾需要有數字）", imageSummary:"共 {count} 張，時間範圍 {min} ~ {max} 分鐘", skippedSummary:"（跳過 {count} 張抓不到數字的）", imageLoaded:"圖片載入：共 {count} 張，時間範圍 {min}~{max} 分鐘", skippedImages:"跳過 {count} 張檔名結尾抓不到數字的圖片", imageOnly:"未上傳，將使用純圖片模式", chooseImagesFirst:"[錯誤] 請先選擇圖片", start:"── 開始產生影片 ──", modeBoth:"模式：OM 圖片 + ECHEM 同步", modeImage:"模式：純 OM 圖片 time-lapse", progress:"進度: {current}/{total} ({pct}%)", download:"下載 {filename}", remove:"移除這個項目", noChangelog:"尚無版本紀錄", autoPlaceholder:"自動偵測", colError:"無法自動偵測時間/電壓欄位。欄位有：{headers}", parseIssues:"echem 解析出現 {count} 個小問題（通常可忽略）"
    },
    en: {
      appTitle:"Synchronized Video Generator", stepInput:"01 / INPUT", inputHeading:"Images and electrochemical data", imageLabel:"OM images (select all image files)", chooseImages:"📁 Choose image files…", echemLabel:"GCPL electrochemical data (optional)", chooseEchem:"📄 Choose TXT file…", filenameHint:'Trailing digits in each image filename are interpreted as minutes. Example: <code>OM_frame_23.jpg</code> → 23 min.', stepFields:"02 / COLUMNS", fieldsHeading:"Electrochemical columns (used only when ECHEM is uploaded)", timeColumn:"Time column", voltageColumn:"Voltage column", currentColumn:"Current column", timeUnit:"Time-column unit", hours:"Hours (h)", minutes:"Minutes (min)", seconds:"Seconds (s)", showCurrent:"Also show the current curve", stepOutput:"03 / OUTPUT", outputHeading:"Video settings", height:"Frame height (px)", duration:"Display time per image (seconds)", generate:"Generate video", reset:"Reset", notStarted:"Not started", previewEmpty:'Choose files and click “Generate video” to preview the composed frames here.', changelog:"Version history / Changelog", statusIdle:"Waiting for input", statusReadyBoth:"Ready (OM + ECHEM)", statusReadyImage:"Ready (images only)", statusBusy:"Generating…", statusDone:"Complete", statusError:"Error", noUsableImages:"No usable images found (filenames must end with digits)", imageSummary:"{count} images, time range {min}–{max} min", skippedSummary:" ({count} without trailing digits skipped)", imageLoaded:"Images loaded: {count}, time range {min}–{max} min", skippedImages:"Skipped {count} images whose filenames do not end with digits", imageOnly:"Not uploaded; image-only mode will be used", chooseImagesFirst:"[Error] Please select images first", start:"── Starting video generation ──", modeBoth:"Mode: synchronized OM images + ECHEM", modeImage:"Mode: OM image-only time-lapse", progress:"Progress: {current}/{total} ({pct}%)", download:"Download {filename}", remove:"Remove this item", noChangelog:"No version history", autoPlaceholder:"Auto-detect", colError:"Could not detect time/voltage columns. Available columns: {headers}", parseIssues:"ECHEM parsing reported {count} minor issues (usually safe to ignore)"
    }
  };
  Object.assign(I18N["zh-TW"], {estimatedDuration:"預估每支影片長度", timelineHint:"影片長度＝圖片數 × 每張顯示時間。原始與差分影片長度一致，不受處理速度影響。FPS 為目標值，圖片切換時會補入影格以保留精確停留時間。", stepCompose:"03 / 同步與畫面", stepOutput:"04 / 輸出", composeHeading:"同步、圖片與標註", imageOffset:"OM 時間偏移 (min)", echemOffset:"ECHEM 時間偏移 (min)", fitMode:"圖片顯示方式", fit:"Fit（完整顯示）", fill:"Fill（填滿裁切）", contrast:"對比度 (%)", brightness:"亮度 (%)", upscale:"高品質插值放大", upscale1:"1×（原始輸出尺寸）", upscale2:"2×（增加插值像素）", upscaleHint:"2× 會將輸出寬高各放大兩倍並使用高品質插值；檔案與記憶體需求也會增加。", visualMode:"輸出模式", bothMode:"原始＋差分（兩個影片）", originalMode:"僅原始影像", differenceMode:"僅相對第一張差分", differenceGain:"差異增益", showScaleBar:"另外疊加尺標", scaleLabel:"尺標文字", scaleLength:"尺標長度 (px)", scaleThickness:"尺標粗細 (px)", differenceHint:"差分顏色代表像素相對第一張發生變化；樣品位移、焦距、照明與曝光改變也會產生差分訊號。", sampleName:"Sample name／自訂標註", showTime:"顯示時間標籤", preview:"更新預覽", previewFrame:"預覽圖片時間", previewOriginal:"原始影像", previewDifference:"相對第一張差分", cancel:"取消產生"});
  Object.assign(I18N.en, {estimatedDuration:"Estimated length per video", timelineHint:"Video length = image count × display time. Original and difference outputs have the same length; processing speed does not affect playback. FPS is a target; extra frames preserve exact image transitions.", stepCompose:"03 / SYNC & FRAME", stepOutput:"04 / OUTPUT", composeHeading:"Synchronization, image, and annotation", imageOffset:"OM time offset (min)", echemOffset:"ECHEM time offset (min)", fitMode:"Image fit mode", fit:"Fit (show entire image)", fill:"Fill (crop to frame)", contrast:"Contrast (%)", brightness:"Brightness (%)", upscale:"High-quality interpolation", upscale1:"1× (original output size)", upscale2:"2× (add interpolated pixels)", upscaleHint:"2× doubles the output width and height using high-quality interpolation; file size and memory use also increase.", visualMode:"Output mode", bothMode:"Original + difference (two videos)", originalMode:"Original only", differenceMode:"Difference from first image only", differenceGain:"Difference gain", showScaleBar:"Overlay scale bar", scaleLabel:"Scale-bar label", scaleLength:"Scale-bar length (px)", scaleThickness:"Scale-bar thickness (px)", differenceHint:"Difference colors indicate pixel changes relative to the first image. Motion, focus, illumination, and exposure changes can also produce difference signals.", sampleName:"Sample name / custom annotation", showTime:"Show time label", preview:"Update preview", previewFrame:"Preview image time", previewOriginal:"Original", previewDifference:"Difference from first", cancel:"Cancel generation"});
  Object.assign(I18N["zh-TW"], {stepAlign:"04 / 對齊與比例尺",stepOutput:"05 / 輸出",alignScaleHeading:"影像對齊與比例尺",alignmentTab:"影像對齊",scaleTab:"插入比例尺",alignEnabled:"對齊所有圖片至第一張",maxShift:"最大位移 (原始 pixel)",alignmentRoi:"Alignment ROI（第一張影像的百分比）",alignmentHint:"請選擇不會鍍鋰、紋理固定的區域，並避開右下角原始尺標、文字及生長中的 Li。只修正 X/Y 平移。",alignmentNotMeasured:"尚未計算位移",previewAligned:"對齊檢查",scalePosition:"比例尺位置",scaleColor:"比例尺顏色",bottomRight:"右下",bottomLeft:"左下",topRight:"右上",topLeft:"左上",scaleHint:"這是獨立疊加的比例尺，不會被納入相對第一張差分或影像對齊計算。"});
  Object.assign(I18N.en, {stepAlign:"04 / ALIGNMENT & SCALE",stepOutput:"05 / OUTPUT",alignScaleHeading:"Image alignment and scale bar",alignmentTab:"Image alignment",scaleTab:"Insert scale bar",alignEnabled:"Align all images to the first image",maxShift:"Maximum shift (source pixels)",alignmentRoi:"Alignment ROI (% of first image)",alignmentHint:"Select a fixed textured region without Li plating. Exclude the original lower-right scale bar, text, and growing Li. Only X/Y translation is corrected.",alignmentNotMeasured:"Shift not measured",previewAligned:"Alignment check",scalePosition:"Scale-bar position",scaleColor:"Scale-bar color",bottomRight:"Bottom right",bottomLeft:"Bottom left",topRight:"Top right",topLeft:"Top left",scaleHint:"This independent overlay is excluded from first-image difference and alignment calculations."});
  Object.assign(I18N["zh-TW"], {detectBlueScale:"自動偵測第一張藍色尺標",pickScaleEndpoints:"在預覽點選尺標兩端",scaleNotCalibrated:"尚未校正；自動偵測或點選第一張圖片尺標兩端。",scalePickPrompt:"請依序點選原始尺標的兩端",scaleDetectFailed:"找不到可靠的藍色水平尺標，請使用手動點選。"});
  Object.assign(I18N.en, {detectBlueScale:"Detect blue scale bar in first image",pickScaleEndpoints:"Pick scale-bar endpoints in preview",scaleNotCalibrated:"Not calibrated. Detect automatically or pick both endpoints on the first image.",scalePickPrompt:"Click the two endpoints of the original scale bar",scaleDetectFailed:"No reliable blue horizontal scale bar was found. Use manual endpoint picking."});
  Object.assign(I18N["zh-TW"], {zoomTab:"Zoom ROI",roiZoomEnabled:"在預覽與影片加入 ROI 放大視窗",selectZoomRoi:"在預覽拖曳選取 ROI",zoomRoiUnset:"尚未選取 ROI。",roiMagnification:"ROI 放大倍率",roiInsetPosition:"放大視窗位置",roiBorderColor:"ROI 邊框顏色",showRoiSourceBox:"顯示原始 ROI 方框",roiZoomHint:"ROI 直接由每張原始圖片重新取樣；啟用影像對齊時，放大視窗會追蹤同一個固定位置。",roiPickPrompt:"請在第一張影像上拖曳選取要放大的區域"});
  Object.assign(I18N.en, {zoomTab:"Zoom ROI",roiZoomEnabled:"Add a magnified ROI inset to preview and video",selectZoomRoi:"Drag to select ROI in preview",zoomRoiUnset:"No ROI selected.",roiMagnification:"ROI magnification",roiInsetPosition:"Inset position",roiBorderColor:"ROI border color",showRoiSourceBox:"Show source ROI box",roiZoomHint:"The ROI is resampled directly from every source image. With alignment enabled, the inset tracks the same fixed location.",roiPickPrompt:"Drag over the first image to select the region to magnify"});
  Object.assign(I18N["zh-TW"], {roiRenderMode:"ROI 顯示模式",roiMatchMain:"Match main image（與主畫面一致）",roiSourceDetail:"Source-resolution detail（原始解析細節）"});
  Object.assign(I18N.en, {roiRenderMode:"ROI rendering mode",roiMatchMain:"Match main image",roiSourceDetail:"Source-resolution detail"});
  Object.assign(I18N["zh-TW"], {showRoiScaleBar:"在 ROI 顯示校正比例尺",roiScaleBarHint:"ROI 尺標沿用主畫面的校正比例，並依實際放大倍率換算；空間不足時會自動改用較短的等比例尺標。"});
  Object.assign(I18N.en, {showRoiScaleBar:"Show calibrated scale bar in ROI",roiScaleBarHint:"The ROI scale bar uses the main-image calibration and the effective magnification. A shorter equivalent scale is selected automatically when space is limited."});
  Object.assign(I18N["zh-TW"], {scaleValue:"比例尺數值",scaleUnit:"比例尺單位"});
  Object.assign(I18N.en, {scaleValue:"Scale-bar value",scaleUnit:"Scale-bar unit"});
  Object.assign(I18N["zh-TW"], {roiLayoutMode:"ROI 版面配置",roiOverlayLayout:"單一 ROI 疊加在原圖",roiGridLayout:"多個 ROI 排列在右側",removeLastZoomRoi:"刪除最後一個 ROI",clearZoomRois:"清除全部 ROI"});
  Object.assign(I18N.en, {roiLayoutMode:"ROI layout",roiOverlayLayout:"Single ROI overlay",roiGridLayout:"Multiple ROIs in right-side grid",removeLastZoomRoi:"Remove last ROI",clearZoomRois:"Clear all ROIs"});
  Object.assign(I18N["zh-TW"], {coverageTab:"Li Coverage",coverageDisclaimer:"以第一張影像為基準量化 optical-change coverage；結果不應單獨視為 Li 的化學鑑定。",coverageRegionShape:"分析區域形狀",coverageRect:"矩形",coverageCircle:"圓形／橢圓形",coverageRegion:"Coverage analysis region",selectCoverageRegion:"在第一張圖拖曳選取",clearCoverageRegion:"清除",coverageRegionUnset:"尚未選取分析區域。",showCoverageMask:"在主圖疊加 Coverage mask",coverageMaskColor:"Mask 顏色",coverageMaskOpacity:"Mask 透明度 (%)",coverageMaskHint:"彩色區域就是被 Coverage 計算納入的像素；它是 optical-change mask，不代表單獨完成 Li 化學鑑定。",coverageThreshold:"變化閾值 (0–255)",coverageMinArea:"最小連通面積 (原圖 px²)",electrodeDiameter:"圓形電極直徑 (cm)",electrodeArea:"電極面積 (cm²)",coverageXAxis:"Coverage 圖 X 軸",xAxisTime:"時間 (min)",xAxisSignedCapacity:"淨面容量 (mAh cm⁻²)",xAxisAbsoluteCapacity:"累積電荷通量 (mAh cm⁻²)",capacityHint:"面容量由 ECHEM 電流對時間做梯形積分。淨面容量保留電流正負號；累積通量使用 |I|，不會因充放電互相抵消。",runCoverageAnalysis:"分析 Li coverage",downloadCoverageCsv:"下載 CSV",coverageNotRun:"尚未分析。"});
  Object.assign(I18N.en, {coverageTab:"Li Coverage",coverageDisclaimer:"Quantifies optical-change coverage relative to the first frame; this alone is not chemical identification of Li.",coverageRegionShape:"Analysis-region shape",coverageRect:"Rectangle",coverageCircle:"Circle / ellipse",coverageRegion:"Coverage analysis region",selectCoverageRegion:"Drag on first image",clearCoverageRegion:"Clear",coverageRegionUnset:"No analysis region selected.",showCoverageMask:"Overlay coverage mask on main image",coverageMaskColor:"Mask color",coverageMaskOpacity:"Mask opacity (%)",coverageMaskHint:"Colored pixels are those included in coverage. This is an optical-change mask, not standalone chemical identification of Li.",coverageThreshold:"Change threshold (0–255)",coverageMinArea:"Minimum connected area (source px²)",electrodeDiameter:"Circular electrode diameter (cm)",electrodeArea:"Electrode area (cm²)",coverageXAxis:"Coverage chart X axis",xAxisTime:"Time (min)",xAxisSignedCapacity:"Signed areal capacity (mAh cm⁻²)",xAxisAbsoluteCapacity:"Cumulative charge throughput (mAh cm⁻²)",capacityHint:"Areal capacity is calculated by trapezoidal integration of ECHEM current over time. Signed capacity preserves current polarity; cumulative throughput integrates |I| and does not cancel between charge and discharge.",runCoverageAnalysis:"Analyze Li coverage",downloadCoverageCsv:"Download CSV",coverageNotRun:"Not analyzed yet."});
  Object.assign(I18N["zh-TW"],{showAvramiFit:"在 Coverage 圖顯示 Avrami 擬合",avramiFitEnd:"擬合截止時間 (min)",avramiFitHint:"僅擬合局部主圖，擬合線只繪製至設定的截止時間；曲線吻合不代表證實成核機制。"});
  Object.assign(I18N.en,{showAvramiFit:"Show Avrami fit on coverage chart",avramiFitEnd:"Fit through time (min)",avramiFitHint:"Fits the local main image only. The fit line stops at the selected time; a good fit does not establish a nucleation mechanism."});
  Object.assign(I18N["zh-TW"],{workflowSection:"快速切換設定頁面",workflowInput:"01 / 圖片與資料",workflowFields:"02 / 電化學欄位",workflowCompose:"03 / 畫面與同步",workflowAlignment:"04 / 影像對齊",workflowScale:"04 / 比例尺",workflowZoom:"04 / Zoom ROI",workflowCoverage:"04 / Li Coverage",workflowOutput:"05 / 影片輸出"});
  Object.assign(I18N.en,{workflowSection:"Jump to settings page",workflowInput:"01 / Images & data",workflowFields:"02 / ECHEM fields",workflowCompose:"03 / Image & sync",workflowAlignment:"04 / Alignment",workflowScale:"04 / Scale bar",workflowZoom:"04 / Zoom ROI",workflowCoverage:"04 / Li Coverage",workflowOutput:"05 / Video output"});
  Object.assign(I18N["zh-TW"],{workflowShortcutHint:"Q：上一頁　A：下一頁（輸入文字時不會觸發）"});
  Object.assign(I18N.en,{workflowShortcutHint:"Q: previous page   A: next page (disabled while typing)"});
  Object.assign(I18N["zh-TW"],{previewKeyboardHint:"J：上一張圖片　L：下一張圖片",roiKeyboardHint:"編輯 ROI 時，方向鍵每次移動 1 個原圖像素；Shift＋方向鍵移動 10 個。多個 ROI 請先點選要移動的框。"});
  Object.assign(I18N.en,{previewKeyboardHint:"J: previous image   L: next image",roiKeyboardHint:"In ROI edit mode, arrow keys move 1 source pixel; Shift + arrow keys move 10. Click a box to choose among multiple ROIs."});
  Object.assign(I18N["zh-TW"],{coverageResultHeading:"Li Coverage 分析結果"});
  Object.assign(I18N.en,{coverageResultHeading:"Li Coverage results"});
  Object.assign(I18N["zh-TW"],{avramiEquationLabel:"Avrami 擬合方程式（局部主圖）",avramiEquationEmpty:"執行 Coverage 分析並勾選 Avrami 擬合後顯示。",copyAvramiEquation:"複製方程式",avramiEquationCopied:"已複製方程式。",avramiEquationCopyFailed:"複製失敗，請直接選取方程式。",avramiEquationInsufficient:"所選時間範圍資料不足，無法擬合。"});
  Object.assign(I18N.en,{avramiEquationLabel:"Avrami fit equation (local main image)",avramiEquationEmpty:"Analyze coverage and enable the Avrami fit to see the equation.",copyAvramiEquation:"Copy equation",avramiEquationCopied:"Equation copied.",avramiEquationCopyFailed:"Could not copy; select the equation directly.",avramiEquationInsufficient:"Not enough data in the selected time range to fit."});
  Object.assign(I18N["zh-TW"], {editZoomRois:"在主圖移動／調整 ROI",editCoverageRegion:"在主圖移動／調整分析區域",roiEditHint:"按下編輯後拖曳區域內部可移動、拖曳四角可調整尺寸；修改分析區域或 ROI 後請重新執行 Coverage 分析。",coverageReanalyze:"分析區域已調整，請重新執行 Coverage 分析。"});
  Object.assign(I18N.en, {editZoomRois:"Move / resize ROIs on main image",editCoverageRegion:"Move / resize analysis region",roiEditHint:"In edit mode, drag inside a region to move it or drag a corner to resize it. Rerun coverage analysis after editing a region or ROI.",coverageReanalyze:"Region changed. Rerun coverage analysis."});
  Object.assign(I18N["zh-TW"], {settingsSection:"設定工具",labelFontSize:"主圖標籤字體大小 (px)"});
  Object.assign(I18N.en, {settingsSection:"Settings section",labelFontSize:"Main-image label font size (px)"});
  let currentLanguage = localStorage.getItem("omEchemLanguage") || "zh-TW";
  if (!I18N[currentLanguage]) currentLanguage = "zh-TW";
  const t = (key, vars = {}) => (I18N[currentLanguage][key] || I18N["zh-TW"][key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const bi = (zh, en) => currentLanguage === "en" ? en : zh;
  function updateDurationEstimate() {
    const result = $("durationEstimate"), formula = $("durationFormula");
    if (!result || !formula) return;
    const count = imageEntries.length;
    const seconds = Number($("frameDuration").value);
    const en = currentLanguage === "en";
    if (!count) {
      result.textContent = "—";
      formula.textContent = en ? "Select images first" : "請先選擇圖片";
      return;
    }
    if (!Number.isFinite(seconds) || seconds < 0.01) {
      result.textContent = "—";
      formula.textContent = en ? "Enter at least 0.01 seconds" : "請輸入至少 0.01 秒";
      return;
    }
    const format = n => n.toLocaleString(en ? "en-US" : "zh-TW", {maximumFractionDigits:3});
    const total = count * seconds;
    result.textContent = `${format(total)} ${en ? "s" : "秒"}`;
    const minutes = Math.floor(total / 60);
    const remainder = Math.round((total - minutes * 60) * 1000) / 1000;
    const clock = total >= 60 ? (en ? ` ≈ ${minutes} min ${format(remainder)} s` : ` ≈ ${minutes} 分 ${format(remainder)} 秒`) : "";
    formula.textContent = en
      ? `${format(count)} images × ${format(seconds)} s${clock}`
      : `${format(count)} 張 × ${format(seconds)} 秒${clock}`;
    formula.title = en ? "Estimate uses selected images; unreadable images are excluded during export." : "依選取圖片估算；輸出時會排除無法讀取的圖片。";
  }
  $("frameDuration").addEventListener("input", updateDurationEstimate);
  $("frameDuration").addEventListener("change", updateDurationEstimate);
  Object.assign(I18N["zh-TW"], {coverageRegionDiameter:"分析區域等效直徑",coverageRegionArea:"框選分析面積",coverageDiameterHint:"等效直徑指相同面積圓的直徑。輸入數值會以中心為基準等比例縮放框選；實際面積須先校正比例尺。這與下方用來換算電流的電極直徑不同。"});
  Object.assign(I18N.en, {coverageRegionDiameter:"Equivalent region diameter",coverageRegionArea:"Selected analysis area",coverageDiameterHint:"Equivalent diameter is the diameter of a circle with the same area. Changing it scales the selection around its center. Calibrate the scale bar for physical area. The electrode diameter below is used separately for current normalization."});
  function applyLanguage() {
    document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-Hant";
    document.title = `OM × ECHEM — ${t("appTitle")} v1.28.0`;
    $("appTitle").textContent = t("appTitle");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    avramiEquation.placeholder = t("avramiEquationEmpty");
    $("colTime").placeholder = currentLanguage === "en" ? "Auto-detect (e.g., time/h)" : "自動偵測 (例如 time/h)";
    $("colVolt").placeholder = currentLanguage === "en" ? "Auto-detect (Ewe/V)" : "自動偵測 (Ewe/V)";
    $("colCurr").placeholder = currentLanguage === "en" ? "Auto-detect (I/mA)" : "自動偵測 (I/mA)";
    versionBadge.title = currentLanguage === "en" ? "View version history" : "查看版本歷程";
    languageSelect.value = currentLanguage;
    updateDurationEstimate();
    if (detectedScale) syncCalibratedScaleLength();
    else if (!scalePickActive) scaleCalibrationStatus.textContent = t("scaleNotCalibrated");
    updateCoverageRegionMeasurements();
    if (zoomRois.length) updateZoomRoiStatus();
    else if (!roiPickActive) zoomRoiStatus.textContent = t("zoomRoiUnset");
  }
    Object.assign(I18N["zh-TW"], {chooseImageFolder:"📂 選擇圖片資料夾…",outputBaseName:"影片檔名（可修改）",folderNameHint:"選擇資料夾時會自動使用其名稱；直接選取圖片檔案時可自行填入名稱。"});
  Object.assign(I18N.en, {chooseImageFolder:"📂 Select image folder…",outputBaseName:"Video filename (editable)",folderNameHint:"Selecting a folder fills in its name automatically. For individual files, enter a name yourself."});
  languageSelect.addEventListener("change", () => {
    currentLanguage = languageSelect.value;
    localStorage.setItem("omEchemLanguage", currentLanguage);
  applyLanguage();
    renderChangelog();
    checkReady();
  });
  applyLanguage();

  // ---------- 版本歷程 modal（工具內建更新日誌，不只靠檔名記錄） ----------
  let changelogEntries = [];
  function renderChangelog() {
    const entries = changelogEntries;
    if (!changelogBody) return;
    if (entries.length) {
      changelogBody.innerHTML = entries.map((entry) => {
        const source = currentLanguage === "en" && entry.notesEn ? entry.notesEn : (entry.notes || []);
        const notes = source.map((n) => `<li>${n}</li>`).join("");
        return `<div class="changelog-entry"><div class="cl-head"><span class="cl-ver">v${entry.version}</span><span class="cl-date">${entry.date || ""}</span></div><ul>${notes}</ul></div>`;
      }).join("");
    } else changelogBody.innerHTML = `<div class="changelog-entry">${t("noChangelog")}</div>`;
  }
  function initChangelog() {
    if (!versionBadge || !changelogOverlay) return; // 舊版 HTML 沒有這些元素時安全跳過
    let entries = [];
    try {
      const raw = document.getElementById("changelogData");
      entries = raw ? JSON.parse(raw.textContent) : [];
      changelogEntries = entries;
    } catch (err) {
      console.error("changelog 資料解析失敗", err);
    }

    if (entries.length) {
      renderChangelog();

      // 檢查檔名/徽章版號跟 changelog 最新一筆是否對得起來，對不上就在 log 裡提醒
      const latest = entries[0].version;
      const badgeVer = versionBadge.dataset.version;
      if (latest !== badgeVer) {
        log(bi(`[警告] 版本徽章顯示 v${badgeVer}，但更新日誌最新一筆是 v${latest}`, `[Warning] Version badge is v${badgeVer}, but the newest changelog entry is v${latest}`), "warn");
      }
    } else {
      renderChangelog();
    }

    const openModal = () => changelogOverlay.classList.add("open");
    const closeModal = () => changelogOverlay.classList.remove("open");
    versionBadge.addEventListener("click", openModal);
    changelogClose.addEventListener("click", closeModal);
    changelogOverlay.addEventListener("click", (e) => {
      if (e.target === changelogOverlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }
  initChangelog();

  function log(msg, cls) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(state, text) {
    statusDot.className = "dot " + state;
    statusText.textContent = text;
  }

  function safeOutputName(name){
    return String(name||"").normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,"_").replace(/[. ]+$/g,"").trim().slice(0,120);
  }
  // ---------- filename minute parsing ----------
  function extractMinute(filename) {
    const stem = filename.replace(/\.[^.]+$/, "");
    const m = stem.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  function handleImagesSelected(input) {
    if(input===folderInput)imgInput.value="";
    else folderInput.value="";
    const files=Array.from(input.files||[]);
    const folder=files[0]?.webkitRelativePath?.split("/")[0]||"";
    outputBaseNameInput.value=input===folderInput?safeOutputName(folder):"";
    imageCache.clear();
    alignmentCache.clear();
    detectedScale = null; scalePickActive = false; scalePickPoints = [];
    zoomRoi = null; zoomRois = []; roiPickActive = false; roiDragStart = null; roiDragCurrent = null; coverageRegion=null; coveragePickActive=false; coverageResults=null; coverageOutputPanel.hidden=true; downloadCoverageCsvBtn.disabled=true;clearAvramiEquation();roiEditMode=null;selectedEditRegion=null;regionEditDrag=null;previewScope.classList.remove("roi-editing");editZoomRoisBtn.setAttribute("aria-pressed","false");editCoverageRegionBtn.setAttribute("aria-pressed","false");
    previewScope.classList.remove("scale-picking");
    previewScope.classList.remove("roi-picking");
    scaleCalibrationStatus.textContent = t("scaleNotCalibrated");
    coverageRegionStatus.textContent = t("coverageRegionUnset");
    updateCoverageRegionMeasurements();
    zoomRoiStatus.textContent = t("zoomRoiUnset");
    previewRequestId++;
    const tagged = [];
    let skipped = 0;
    for (const f of files) {
      if(!f.type.startsWith("image/")&&!/\.(?:png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(f.name))continue;
      const minute = extractMinute(f.name);
      if (minute === null) {
        skipped++;
        continue;
      }
      tagged.push({ minute, file: f });
    }
    tagged.sort((a, b) => a.minute - b.minute);
    imageEntries = tagged;
    updateDurationEstimate();
    previewSlider.max = Math.max(0, tagged.length - 1);
    previewSlider.value = "0";
    previewSlider.disabled = tagged.length === 0;

    if (tagged.length === 0) {
      imgSummary.textContent = t("noUsableImages");
      imgSummary.className = "filesummary warn";
    } else {
      imgSummary.textContent =
        t("imageSummary", {count:tagged.length, min:tagged[0].minute, max:tagged[tagged.length - 1].minute}) +
        (skipped ? t("skippedSummary", {count:skipped}) : "");
      imgSummary.className = "filesummary";
      log(t("imageLoaded", {count:tagged.length, min:tagged[0].minute, max:tagged[tagged.length - 1].minute}), "ok");
      if (skipped) log(t("skippedImages", {count:skipped}), "warn");
      const duplicateCount = tagged.filter((entry, idx) => idx > 0 && entry.minute === tagged[idx - 1].minute).length;
      if (duplicateCount) log(bi(`[警告] 發現 ${duplicateCount} 個重複圖片時間`, `[Warning] Found ${duplicateCount} duplicate image timestamps`), "warn");
      const secondsPerImage = Math.max(0.01, parseFloat($("frameDuration").value) || 0.5);
      log(bi(`預估影片長度：約 ${(tagged.length * secondsPerImage).toFixed(1)} 秒`, `Estimated video length: ${(tagged.length * secondsPerImage).toFixed(1)} seconds`));
      preloadAround(0);
    }
    checkReady();
  }
  imgInput.addEventListener("change",()=>handleImagesSelected(imgInput));
  folderInput.addEventListener("change",()=>handleImagesSelected(folderInput));

  // ---------- echem 檔案載入（委派給 EchemModule 解析） ----------
  echemInput.addEventListener("change", () => {
    const file = echemInput.files && echemInput.files[0];
    if (!file) {
      echemT = [];
      echemV = [];
      echemI = null;
      echemColsDetected = null;
      echemSummary.textContent = t("imageOnly");
      echemSummary.className = "filesummary";
      checkReady();
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const unit = $("timeUnit").value;
      const result = Echem.parse(text, {
        colTime: $("colTime").value,
        colVolt: $("colVolt").value,
        colCurr: $("colCurr").value,
        timeUnit: unit,
      });

      if (result.parseErrorCount) {
        log(t("parseIssues", {count:result.parseErrorCount}), "warn");
      }

      if (!result.ok) {
        echemSummary.textContent = t("colError", {headers:result.headers.join(", ")});
        echemSummary.className = "filesummary warn";
        log(bi(`[錯誤] 無法自動偵測時間或電壓欄位。實際欄位：${result.headers.join(", ")}`, `[Error] Could not detect time or voltage column. Available columns: ${result.headers.join(", ")}`), "err");
        echemColsDetected = null;
        echemT = [];
        echemV = [];
        echemI = null;
        checkReady();
        return;
      }

      echemT = result.t;
      echemV = result.v;
      echemI = result.iArr;
      echemColsDetected = result.colsDetected;

      if (result.timeMode === "datetime") {
        log(bi("已辨識日期時間格式，並以第一筆資料作為 t = 0。時間欄單位選項將自動忽略。", "Date-time format detected and converted to elapsed time from t = 0. The time-unit selector is ignored."), "ok");
      }

      const { timeCol, voltCol, currCol } = echemColsDetected;
      echemSummary.textContent = `time='${timeCol}' volt='${voltCol}' curr='${currCol || bi("無", "none")}' · ${echemT.length} ${bi("筆", "rows")}`;
      echemSummary.className = "filesummary";
      log(bi(`echem 欄位偵測：time='${timeCol}', voltage='${voltCol}', current='${currCol || "無"}'（共 ${echemT.length} 筆有效資料）`, `ECHEM columns: time='${timeCol}', voltage='${voltCol}', current='${currCol || "none"}' (${echemT.length} valid rows)`), "ok");

      if (echemT.length > 0) {
        const tMinH = Math.min(...echemT),
          tMaxH = Math.max(...echemT);
        log(bi(`echem 時間範圍（已換算成小時）：${tMinH.toFixed(3)} ~ ${tMaxH.toFixed(3)} h`, `ECHEM time range (converted to hours): ${tMinH.toFixed(3)}–${tMaxH.toFixed(3)} h`), "ok");
        if (imageEntries.length > 0) {
          const imgMinH = imageEntries[0].minute / 60,
            imgMaxH = imageEntries[imageEntries.length - 1].minute / 60;
          log(bi(`圖片時間範圍（分鐘換算成小時）：${imgMinH.toFixed(3)} ~ ${imgMaxH.toFixed(3)} h`, `Image time range (minutes converted to hours): ${imgMinH.toFixed(3)}–${imgMaxH.toFixed(3)} h`), "ok");
          if (Echem.checkRangeMismatch(tMinH, tMaxH, imgMinH, imgMaxH)) {
            log(bi(`[警告] echem 與圖片時間範圍差異很大，請確認時間欄單位（目前：${Echem.unitLabel(unit)}）。`, `[Warning] The ECHEM and image time ranges differ greatly. Check the selected time unit (${unit}).`), "warn");
          }
        }
      }
      checkReady();
    };
    reader.readAsText(file);
  });

  // re-check columns if user manually types col names after file already loaded
  ["colTime", "colVolt", "colCurr", "timeUnit"].forEach((id) => {
    $(id).addEventListener("change", () => {
      if (echemInput.files && echemInput.files[0]) echemInput.dispatchEvent(new Event("change"));
    });
  });

  function checkReady() {
    const ready = imageEntries.length > 0 && !generating;
    genBtn.disabled = !ready;
    previewBtn.disabled = imageEntries.length === 0 || generating;
    if (ready) setStatus("ready", echemT.length > 0 ? t("statusReadyBoth") : t("statusReadyImage"));
  }

  function addDownloadEntry(url, filename, infoText) {
    downloadUrls.push(url);
    const bar = document.createElement("div");
    bar.className = "downloadbar";

    const span = document.createElement("span");
    span.textContent = infoText;

    const actions = document.createElement("div");
    actions.className = "dl-actions";

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.textContent = t("download", {filename});

    const removeBtn = document.createElement("button");
    removeBtn.className = "dl-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = t("remove");
    removeBtn.addEventListener("click", () => {
      URL.revokeObjectURL(url);
      downloadUrls = downloadUrls.filter((u) => u !== url);
      bar.remove();
    });

    actions.appendChild(a);
    actions.appendChild(removeBtn);
    bar.appendChild(span);
    bar.appendChild(actions);
    downloadList.insertBefore(bar, downloadList.firstChild); // 新的排最上面
  }

  resetBtn.addEventListener("click", () => {
    if (generating) return;
    imageEntries = [];
    updateDurationEstimate();
    echemT = [];
    echemV = [];
    echemI = null;
    imgInput.value = "";
    folderInput.value = "";
    outputBaseNameInput.value = "";
    echemInput.value = "";
    imgSummary.textContent = "";
    echemSummary.textContent = "";
    previewSlider.value = "0";
    previewSlider.max = "0";
    previewVisualMode = "original";
    previewModeTabs.forEach((tab) => {
      const active = tab.dataset.previewMode === "original";
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    imageCache.clear();
    alignmentCache.clear();
    detectedScale = null; scalePickActive = false; scalePickPoints = [];
    zoomRoi = null; zoomRois = []; roiPickActive = false; roiDragStart = null; roiDragCurrent = null; coverageRegion=null; coveragePickActive=false; coverageResults=null; coverageOutputPanel.hidden=true; downloadCoverageCsvBtn.disabled=true;clearAvramiEquation();roiEditMode=null;selectedEditRegion=null;previewScope.classList.remove("roi-editing");editZoomRoisBtn.setAttribute("aria-pressed","false");editCoverageRegionBtn.setAttribute("aria-pressed","false");
    previewScope.classList.remove("scale-picking");
    previewScope.classList.remove("roi-picking");
    scaleCalibrationStatus.textContent = t("scaleNotCalibrated");
    zoomRoiStatus.textContent = t("zoomRoiUnset");
    coverageRegionStatus.textContent = t("coverageRegionUnset");
    updateCoverageRegionMeasurements();
    previewRequestId++;
    if (previewAnimationFrame) cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = 0;
    logEl.innerHTML = "";
    progFill.style.width = "0%";
    progText.textContent = t("notStarted");
    downloadUrls.forEach((u) => URL.revokeObjectURL(u));
    downloadUrls = [];
    downloadList.innerHTML = "";
    scopeEmpty.style.display = "flex";
    stageCanvas.style.display = "none";
    readout.innerHTML = "";
    setStatus("", t("statusIdle"));
    genBtn.disabled = true;
    previewBtn.disabled = true;
    previewSlider.disabled = true;
  });

  // ---------- image loading helper ----------
  function loadImage(file) {
    if (imageCache.has(file)) {
      const cached = imageCache.get(file);
      imageCache.delete(file);
      imageCache.set(file, cached);
      return cached;
    }
    const promise = new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        imageCache.delete(file);
        reject(new Error(bi(`瀏覽器無法解碼此圖片：${file.name}（可能不是標準 JPG/PNG/WebP）`, `The browser could not decode ${file.name}. It may not be a standard JPG/PNG/WebP file.`)));
      };
      img.src = url;
    });
    imageCache.set(file, promise);
    while (imageCache.size > IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value);
    return promise;
  }

  function preloadAround(index) {
    [-2, -1, 0, 1, 2].forEach((offset) => {
      const entry = imageEntries[index + offset];
      if (entry) loadImage(entry.file).catch(() => {});
    });
  }

  // 依序嘗試載入圖片，回傳第一張成功解碼的（連同它在陣列中的位置），
  // 讓「第一張圖讀取失敗」不會讓整個流程直接中斷
  async function findFirstLoadable(entries) {
    for (let idx = 0; idx < entries.length; idx++) {
      try {
        const img = await loadImage(entries[idx].file);
        return { img, idx };
      } catch (err) {
        log(bi(`[警告] ${err.message}，略過此檔`, `[Warning] ${err.message} Skipping this file.`), "warn");
      }
    }
    return null;
  }

  function frameSettings() {
    const imageOffsetMin = parseFloat($("imageOffset").value) || 0;
    const echemOffsetMin = parseFloat($("echemOffset").value) || 0;
    const contrastInput = parseFloat($("contrastValue").value);
    const brightnessInput = parseFloat($("brightnessValue").value);
    return {
      outH: Math.max(240, parseInt($("outH").value, 10) || 480),
      fitMode: $("fitMode").value,
      contrast: Math.max(0, Math.min(300, Number.isFinite(contrastInput) ? contrastInput : 100)),
      brightness: Math.max(0, Math.min(200, Number.isFinite(brightnessInput) ? brightnessInput : 100)),
      upscaleFactor: Math.max(1, Math.min(2, parseInt($("upscaleFactor").value, 10) || 1)),
      imageOffsetMin,
      adjustedT: echemT.map((value) => value + echemOffsetMin / 60),
      annotation: $("sampleName").value.trim(),
      labelFontSize: Math.max(8,Math.min(48,parseInt($("labelFontSize").value,10)||18)),
      showTime: $("showTime").checked,
      visualMode: $("visualMode").value,
      differenceGain: Math.max(1, Math.min(20, parseFloat($("differenceGain").value) || 4)),
      showScaleBar: $("showScaleBar").checked,
      scaleValue: Math.max(0.01, Math.min(1000000, parseFloat($("scaleValue").value) || 100)),
      scaleUnit: $("scaleUnit").value,
      scaleLabel: `${Math.max(0.01, Math.min(1000000, parseFloat($("scaleValue").value) || 100))} ${$("scaleUnit").value}`,
      scaleLength: Math.max(10, parseInt($("scaleLength").value, 10) || 120),
      scaleThickness: Math.max(1, parseInt($("scaleThickness").value, 10) || 6),
      scalePosition: $("scalePosition").value,
      scaleColor: $("scaleColor").value || "#ffffff",
      alignEnabled: $("alignEnabled").checked,
      maxShift: Math.max(1, Math.min(100, parseInt($("maxShift").value, 10) || 20)),
      alignmentRoi: {
        x: Math.max(0, Math.min(95, parseFloat($("roiX").value) || 0)) / 100,
        y: Math.max(0, Math.min(95, parseFloat($("roiY").value) || 0)) / 100,
        w: Math.max(5, Math.min(100, parseFloat($("roiW").value) || 70)) / 100,
        h: Math.max(5, Math.min(100, parseFloat($("roiH").value) || 70)) / 100
      },
      roiZoomEnabled: $("roiZoomEnabled").checked && zoomRois.length > 0,
      roiLayoutMode: $("roiLayoutMode").value,
      zoomRoi: zoomRois.length ? {...zoomRois[0]} : null,
      zoomRois: zoomRois.map(roi => ({...roi})),
      roiMagnification: Math.max(1.25, Math.min(8, parseFloat($("roiMagnification").value) || 3)),
      roiRenderMode: $("roiRenderMode").value,
      roiInsetPosition: $("roiInsetPosition").value,
      roiBorderColor: $("roiBorderColor").value || "#57d9c4",
      showRoiSourceBox: $("showRoiSourceBox").checked,
      showRoiScaleBar: $("showRoiScaleBar").checked,
      currentShift: {x:0, y:0, score:1},
      baselineImg: null
    };
  }

  function grayscaleImage(img, referenceWidth, referenceHeight, maxDimension) {
    const scale = Math.min(1, maxDimension / Math.max(referenceWidth, referenceHeight));
    const width = Math.max(1, Math.round(referenceWidth * scale));
    const height = Math.max(1, Math.round(referenceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", {willReadFrequently:true});
    ctx.drawImage(img, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let p = 0, q = 0; p < rgba.length; p += 4, q++) gray[q] = rgba[p] * .299 + rgba[p + 1] * .587 + rgba[p + 2] * .114;
    return {gray, width, height, scale};
  }

  function syncCalibratedScaleLength() {
    if (!detectedScale) return;
    const outH = Math.max(240, parseInt($("outH").value, 10) || 480);
    const outputPixels = detectedScale.sourcePixels * outH / detectedScale.sourceHeight;
    $("scaleLength").value = String(Math.max(10, Math.round(outputPixels)));
    scaleCalibrationStatus.textContent = bi(
      `${detectedScale.method === "auto" ? "自動偵測" : "手動點選"}：原圖 ${detectedScale.sourcePixels.toFixed(2)} px → 輸出 ${outputPixels.toFixed(2)} px`,
      `${detectedScale.method === "auto" ? "Auto detected" : "Manually selected"}: source ${detectedScale.sourcePixels.toFixed(2)} px → output ${outputPixels.toFixed(2)} px`
    );
  }

  const coverageUnitCm = {nm:1e-7,"µm":1e-4,mm:0.1,cm:1};
  function coverageRegionGeometry(){
    if(!coverageRegion)return null;
    const width=coverageRegion.w*coverageRegion.sourceWidth,height=coverageRegion.h*coverageRegion.sourceHeight;
    const area=width*height*(coverageRegion.shape==="circle"?Math.PI/4:1);
    return {width,height,area,diameter:2*Math.sqrt(area/Math.PI)};
  }
  function coverageCmPerPixel(){
    const value=Number($("scaleValue").value),unit=coverageUnitCm[$("scaleUnit").value];
    return detectedScale&&unit&&Number.isFinite(value)&&value>0 ? value*unit/detectedScale.sourcePixels : null;
  }
  function updateCoverageRegionMeasurements(){
    const geometry=coverageRegionGeometry();
    coverageRegionDiameterInput.disabled=!geometry;
    if(!geometry){coverageRegionDiameterInput.value="";coverageRegionAreaReadout.value="—";return;}
    const cmPerPixel=coverageCmPerPixel();
    if(!cmPerPixel&&coverageRegionDiameterUnit.value!=="px")coverageRegionDiameterUnit.value="px";
    const unit=coverageRegionDiameterUnit.value;
    const converted=unit==="px"?geometry.diameter:geometry.diameter*cmPerPixel/coverageUnitCm[unit];
    if(document.activeElement!==coverageRegionDiameterInput)coverageRegionDiameterInput.value=Number(converted.toPrecision(8)).toString();
    const pxArea=`${geometry.area.toFixed(0)} px²`;
    coverageRegionAreaReadout.value=cmPerPixel?`${pxArea} ≈ ${(geometry.area*cmPerPixel*cmPerPixel/coverageUnitCm[$("scaleUnit").value]**2).toPrecision(5)} ${$("scaleUnit").value}²`:pxArea;
    coverageRegionStatus.textContent=bi(`已選取${coverageRegion.shape==="circle"?"圓形／橢圓形":"矩形"}區域：${geometry.width.toFixed(0)} × ${geometry.height.toFixed(0)} px`,`Selected ${coverageRegion.shape==="circle"?"circular / elliptical":"rectangular"} region: ${geometry.width.toFixed(0)} × ${geometry.height.toFixed(0)} px`);
  }
  coverageRegionDiameterUnit.addEventListener("change",()=>{
    if(coverageRegionDiameterUnit.value!=="px"&&!coverageCmPerPixel())coverageRegionDiameterUnit.value="px";
    updateCoverageRegionMeasurements();
  });
  coverageRegionDiameterInput.addEventListener("change",()=>{
    const geometry=coverageRegionGeometry(),target=Number(coverageRegionDiameterInput.value),unit=coverageRegionDiameterUnit.value;
    const cmPerPixel=coverageCmPerPixel();
    if(!geometry||!Number.isFinite(target)||target<=0||unit!=="px"&&!cmPerPixel){updateCoverageRegionMeasurements();return;}
    const desiredPx=unit==="px"?target:target*coverageUnitCm[unit]/cmPerPixel;
    const factor=desiredPx/geometry.diameter;
    const newW=coverageRegion.w*factor,newH=coverageRegion.h*factor;
    if(!Number.isFinite(newW)||!Number.isFinite(newH)||newW<2/coverageRegion.sourceWidth||newH<2/coverageRegion.sourceHeight||newW>1||newH>1){
      coverageRegionDiameterInput.blur();updateCoverageRegionMeasurements();return;
    }
    const cx=coverageRegion.x+coverageRegion.w/2,cy=coverageRegion.y+coverageRegion.h/2;
    coverageRegion={...coverageRegion,w:newW,h:newH,x:Math.max(0,Math.min(1-newW,cx-newW/2)),y:Math.max(0,Math.min(1-newH,cy-newH/2))};
    coverageRegionDiameterInput.blur();invalidateCoverage();updateCoverageRegionMeasurements();schedulePreview();
  });

  function applyScaleCalibration(sourcePixels, sourceHeight, method, endpoints = null) {
    if (!Number.isFinite(sourcePixels) || sourcePixels < 2) return;
    detectedScale = {sourcePixels, sourceHeight, method, endpoints};
    $("showScaleBar").checked = true;
    syncCalibratedScaleLength();
    updateCoverageRegionMeasurements();
    schedulePreview();
  }

  async function detectBlueScaleBar() {
    if (generating) return;
    if (!imageEntries.length) { scaleCalibrationStatus.textContent = t("chooseImagesFirst"); return; }
    detectBlueScaleBtn.disabled = true;
    try {
      const img = await loadImage(imageEntries[0].file);
      const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d", {willReadFrequently:true}); ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const xStart = Math.floor(img.width * .35), yStart = Math.floor(img.height * .45);
      let best = null;
      const isBlue = (p) => {
        const r = data[p], g = data[p + 1], b = data[p + 2];
        return b >= 80 && b > r * 1.28 && b > g * 1.12 && b - r >= 30;
      };
      for (let y = yStart; y < img.height; y++) {
        let start = -1, last = -1, gap = 0;
        for (let x = xStart; x <= img.width; x++) {
          const blue = x < img.width && isBlue((y * img.width + x) * 4);
          if (blue) { if (start < 0) start = x; last = x; gap = 0; }
          else if (start >= 0 && ++gap > 3) {
            const length = last - start + 1;
            if (!best || length > best.length) best = {x1:start, x2:last, y, length};
            start = -1; last = -1; gap = 0;
          }
        }
      }
      if (!best || best.length < Math.max(12, img.width * .015)) {
        detectedScale = null;
        scaleCalibrationStatus.textContent = t("scaleDetectFailed");
        return;
      }
      previewSlider.value = "0";
      applyScaleCalibration(best.length, img.height, "auto", [{x:best.x1,y:best.y},{x:best.x2,y:best.y}]);
    } finally { detectBlueScaleBtn.disabled = false; }
  }

  function beginScaleEndpointPicking() {
    if (generating) return;
    if (!imageEntries.length) { scaleCalibrationStatus.textContent = t("chooseImagesFirst"); return; }
    scalePickActive = true; scalePickPoints = [];
    previewSlider.value = "0"; previewVisualMode = "original";
    previewModeTabs.forEach((tab) => { const active = tab.dataset.previewMode === "original"; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    previewScope.classList.add("scale-picking");
    scaleCalibrationStatus.textContent = t("scalePickPrompt") + " (0/2)";
    schedulePreview();
  }

  detectBlueScaleBtn.addEventListener("click", detectBlueScaleBar);
  pickScaleEndpointsBtn.addEventListener("click", beginScaleEndpointPicking);
  stageCanvas.addEventListener("click", async (event) => {
    if (!scalePickActive || !imageEntries.length) return;
    const img = await loadImage(imageEntries[0].file);
    const rect = stageCanvas.getBoundingClientRect();
    const pixelScale = Math.max(1, parseInt($("upscaleFactor").value, 10) || 1);
    const logicalX = (event.clientX - rect.left) * stageCanvas.width / rect.width / pixelScale;
    const logicalY = (event.clientY - rect.top) * stageCanvas.height / rect.height / pixelScale;
    const outH = Math.max(240, parseInt($("outH").value, 10) || 480);
    const imgW = Math.round(outH * img.width / img.height);
    if (logicalX < 0 || logicalX > imgW || logicalY < 0 || logicalY > outH) return;
    scalePickPoints.push({x:logicalX * img.width / imgW, y:logicalY * img.height / outH});
    scaleCalibrationStatus.textContent = t("scalePickPrompt") + ` (${scalePickPoints.length}/2)`;
    if (scalePickPoints.length === 2) {
      const [a,b] = scalePickPoints;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      scalePickActive = false; previewScope.classList.remove("scale-picking");
      applyScaleCalibration(length, img.height, "manual", [a,b]);
    } else schedulePreview();
  });

  function updateZoomRoiStatus() {
    if (!zoomRois.length) { zoomRoiStatus.textContent = t("zoomRoiUnset"); return; }
    zoomRoi = zoomRois[0];
    const index=selectedEditRegion?.kind==="zoom"?selectedEditRegion.index:zoomRois.length-1;
    const selected=zoomRois[index];
    const wPx = selected.sourceWidth ? selected.w * selected.sourceWidth : 0;
    const hPx = selected.sourceHeight ? selected.h * selected.sourceHeight : 0;
    zoomRoiStatus.textContent = bi(
      `共 ${zoomRois.length} 個 ROI；ROI ${index+1} 尺寸 ${wPx.toFixed(0)} × ${hPx.toFixed(0)} px`,
      `${zoomRois.length} ROI(s); ROI ${index+1} size ${wPx.toFixed(0)} × ${hPx.toFixed(0)} px`
    );
  }

  function previewPointerToNormalized(event) {
    const rect = stageCanvas.getBoundingClientRect();
    const pixelScale = Math.max(1, parseInt($("upscaleFactor").value, 10) || 1);
    const outH = Math.max(240, parseInt($("outH").value, 10) || 480);
    const imgW = Math.round(outH * roiReferenceAspect);
    const logicalX = (event.clientX - rect.left) * stageCanvas.width / rect.width / pixelScale;
    const logicalY = (event.clientY - rect.top) * stageCanvas.height / rect.height / pixelScale;
    return {x:Math.max(0,Math.min(1,logicalX/imgW)), y:Math.max(0,Math.min(1,logicalY/outH)), inside:logicalX>=0&&logicalX<=imgW&&logicalY>=0&&logicalY<=outH};
  }

  function setRoiEditMode(mode){
    roiEditMode=mode;selectedEditRegion=mode==="coverage"?{kind:"coverage",index:0}:mode==="zoom"&&zoomRois.length?{kind:"zoom",index:zoomRois.length-1}:null;regionEditDrag=null;
    stageCanvas.style.cursor="";
    roiPickActive=false;coveragePickActive=false;roiDragStart=null;roiDragCurrent=null;
    scalePickActive=false;previewScope.classList.remove("scale-picking","roi-picking");
    previewScope.classList.toggle("roi-editing",!!mode);
    editZoomRoisBtn.setAttribute("aria-pressed",String(mode==="zoom"));
    editCoverageRegionBtn.setAttribute("aria-pressed",String(mode==="coverage"));
    if(mode==="zoom")updateZoomRoiStatus();
    schedulePreview();
  }
  function invalidateCoverage(){
    if(!coverageResults)return;
    coverageResults=null;coverageOutputPanel.hidden=true;downloadCoverageCsvBtn.disabled=true;clearAvramiEquation();
    coverageStatus.textContent=t("coverageReanalyze");
    coverageChart.getContext("2d").clearRect(0,0,coverageChart.width,coverageChart.height);
  }
  async function toggleRoiEditing(mode){
    if(generating)return;
    if(roiEditMode===mode){setRoiEditMode(null);return;}
    if(!imageEntries.length){(mode==="coverage"?coverageRegionStatus:zoomRoiStatus).textContent=t("chooseImagesFirst");return;}
    if(mode==="coverage"&&!coverageRegion){coverageRegionStatus.textContent=t("coverageRegionUnset");return;}
    if(mode==="zoom"&&!zoomRois.length){zoomRoiStatus.textContent=t("zoomRoiUnset");return;}
    const first=await loadImage(imageEntries[0].file);roiReferenceAspect=first.width/first.height;
    previewSlider.value="0";setRoiEditMode(mode);
  }
  editZoomRoisBtn.addEventListener("click",()=>toggleRoiEditing("zoom"));
  editCoverageRegionBtn.addEventListener("click",()=>toggleRoiEditing("coverage"));

  function hitEditableRegion(p,region,imgW,outH){
    const tolerance=12, corners=[[region.x,region.y,"nw"],[region.x+region.w,region.y,"ne"],[region.x,region.y+region.h,"sw"],[region.x+region.w,region.y+region.h,"se"]];
    for(const [x,y,part] of corners)if(Math.hypot((p.x-x)*imgW,(p.y-y)*outH)<=tolerance)return part;
    if(p.x>=region.x&&p.x<=region.x+region.w&&p.y>=region.y&&p.y<=region.y+region.h){
      if(region.shape==="circle"){const dx=(p.x-region.x-region.w/2)/(region.w/2),dy=(p.y-region.y-region.h/2)/(region.h/2);if(dx*dx+dy*dy>1)return null;}
      return "move";
    }
    return null;
  }
  function editableTarget(p){
    const outH=Math.max(240,parseInt($("outH").value,10)||480),imgW=outH*roiReferenceAspect;
    const targets=roiEditMode==="coverage"?[{kind:"coverage",index:0,region:coverageRegion}]:zoomRois.map((region,index)=>({kind:"zoom",index,region})).reverse();
    if(selectedEditRegion){const target=targets.find(v=>v.kind===selectedEditRegion.kind&&v.index===selectedEditRegion.index);if(target){const part=hitEditableRegion(p,target.region,imgW,outH);if(part)return {...target,part};}}
    for(const target of targets){if(!target.region)continue;const part=hitEditableRegion(p,target.region,imgW,outH);if(part)return {...target,part};}
    return null;
  }
  function adjustedRegion(original,start,p,part){
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    if(part==="move")return {...original,x:clamp(original.x+p.x-start.x,0,1-original.w),y:clamp(original.y+p.y-start.y,0,1-original.h)};
    const right=original.x+original.w,bottom=original.y+original.h;
    const left=part.includes("w")?clamp(p.x,0,right-.02):original.x;
    const top=part.includes("n")?clamp(p.y,0,bottom-.02):original.y;
    const newRight=part.includes("e")?clamp(p.x,left+.02,1):right;
    const newBottom=part.includes("s")?clamp(p.y,top+.02,1):bottom;
    return {...original,x:left,y:top,w:newRight-left,h:newBottom-top};
  }

  function moveRegionBySourcePixels(region,dx,dy){
    if(!region||!(region.sourceWidth>0)||!(region.sourceHeight>0))return region;
    const x=Math.max(0,Math.min(1-region.w,region.x+dx/region.sourceWidth));
    const y=Math.max(0,Math.min(1-region.h,region.y+dy/region.sourceHeight));
    return x===region.x&&y===region.y?region:{...region,x,y};
  }

  function nudgeSelectedRoi(key,step){
    if(!roiEditMode||!selectedEditRegion||regionEditDrag||generating||roiPickActive||coveragePickActive||scalePickActive)return false;
    const region=selectedEditRegion.kind==="coverage"?coverageRegion:zoomRois[selectedEditRegion.index];
    if(!region)return false;
    const dx=key==="ArrowLeft"?-step:key==="ArrowRight"?step:0;
    const dy=key==="ArrowUp"?-step:key==="ArrowDown"?step:0;
    const next=moveRegionBySourcePixels(region,dx,dy);
    if(next!==region){
      invalidateCoverage();
      if(selectedEditRegion.kind==="coverage"){
        coverageRegion=next;updateCoverageRegionMeasurements();
      }else{
        zoomRois[selectedEditRegion.index]=next;zoomRoi=zoomRois[0];updateZoomRoiStatus();
      }
      schedulePreview();
    }
    return true;
  }

  async function beginZoomRoiPicking() {
    if (generating || !imageEntries.length) { if (!imageEntries.length) zoomRoiStatus.textContent = t("chooseImagesFirst"); return; }
    const firstImg = await loadImage(imageEntries[0].file);
    roiReferenceAspect = firstImg.width / firstImg.height;
    setRoiEditMode(null);
    roiPickActive = true; roiDragStart = null; roiDragCurrent = null;
    scalePickActive = false; previewScope.classList.remove("scale-picking");
    previewSlider.value = "0"; previewVisualMode = "original";
    previewModeTabs.forEach((tab) => { const active = tab.dataset.previewMode === "original"; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    previewScope.classList.add("roi-picking");
    zoomRoiStatus.textContent = t("roiPickPrompt");
    schedulePreview();
  }

  selectZoomRoiBtn.addEventListener("click", beginZoomRoiPicking);
  async function beginCoverageRegionPicking(){
    if(generating||!imageEntries.length){coverageRegionStatus.textContent=t("chooseImagesFirst");return;}
    const firstImg=await loadImage(imageEntries[0].file);roiReferenceAspect=firstImg.width/firstImg.height;
    setRoiEditMode(null);
    coveragePickActive=true;roiPickActive=false;scalePickActive=false;roiDragStart=null;roiDragCurrent=null;
    previewSlider.value="0";previewVisualMode="original";previewScope.classList.add("roi-picking");
    coverageRegionStatus.textContent=bi("请在第一张影像上拖曳分析区域。","Drag the analysis region on the first image.");schedulePreview();
  }
  selectCoverageRegionBtn.addEventListener("click",beginCoverageRegionPicking);
  clearCoverageRegionBtn.addEventListener("click",()=>{if(generating)return;coverageRegion=null;invalidateCoverage();setRoiEditMode(null);coverageRegionStatus.textContent=t("coverageRegionUnset");updateCoverageRegionMeasurements();schedulePreview();});
  stageCanvas.addEventListener("pointerdown", (event) => {
    if(roiEditMode){
      const p=previewPointerToNormalized(event);if(!p.inside)return;
      const hit=editableTarget(p);if(!hit)return;
      event.preventDefault();stageCanvas.setPointerCapture(event.pointerId);
      selectedEditRegion={kind:hit.kind,index:hit.index};
      regionEditDrag={start:p,part:hit.part,original:{...hit.region},changed:false};
      schedulePreview();return;
    }
    if (!roiPickActive&&!coveragePickActive) return;
    const p = previewPointerToNormalized(event); if (!p.inside) return;
    event.preventDefault(); stageCanvas.setPointerCapture(event.pointerId);
    roiDragStart = {x:p.x,y:p.y}; roiDragCurrent = {...roiDragStart}; schedulePreview();
  });
  stageCanvas.addEventListener("pointermove", (event) => {
    if(roiEditMode&&!regionEditDrag){
      const p=previewPointerToNormalized(event),hit=p.inside?editableTarget(p):null;
      stageCanvas.style.cursor=hit?(hit.part==="move"?"move":(["nw","se"].includes(hit.part)?"nwse-resize":"nesw-resize")):"default";
    }
    if(regionEditDrag&&stageCanvas.hasPointerCapture(event.pointerId)){
      const p=previewPointerToNormalized(event),drag=regionEditDrag;
      const next=adjustedRegion(drag.original,drag.start,p,drag.part);
      if(next.x!==drag.original.x||next.y!==drag.original.y||next.w!==drag.original.w||next.h!==drag.original.h){if(!drag.changed)invalidateCoverage();drag.changed=true;}
      if(selectedEditRegion.kind==="coverage")coverageRegion=next;
      else{zoomRois[selectedEditRegion.index]=next;zoomRoi=zoomRois[0];}
      schedulePreview();return;
    }
    if ((!roiPickActive&&!coveragePickActive) || !roiDragStart || !stageCanvas.hasPointerCapture(event.pointerId)) return;
    const p = previewPointerToNormalized(event); roiDragCurrent = {x:p.x,y:p.y}; schedulePreview();
  });
  stageCanvas.addEventListener("pointerup", async (event) => {
    if(regionEditDrag){
      if(stageCanvas.hasPointerCapture(event.pointerId))stageCanvas.releasePointerCapture(event.pointerId);
      if(regionEditDrag.changed){if(selectedEditRegion.kind==="coverage")updateCoverageRegionMeasurements();else updateZoomRoiStatus();}
      regionEditDrag=null;schedulePreview();return;
    }
    if ((!roiPickActive&&!coveragePickActive) || !roiDragStart) return;
    if (stageCanvas.hasPointerCapture(event.pointerId)) stageCanvas.releasePointerCapture(event.pointerId);
    const p = previewPointerToNormalized(event); roiDragCurrent = {x:p.x,y:p.y};
    const x = Math.min(roiDragStart.x,roiDragCurrent.x), y = Math.min(roiDragStart.y,roiDragCurrent.y);
    const w = Math.abs(roiDragCurrent.x-roiDragStart.x), h = Math.abs(roiDragCurrent.y-roiDragStart.y);
    if (w >= .02 && h >= .02) {
      const img = await loadImage(imageEntries[0].file);
      const roi = {x,y,w,h,sourceWidth:img.width,sourceHeight:img.height};
      if(coveragePickActive){
        coverageRegion={...roi,shape:$("coverageRegionShape").value};coveragePickActive=false;invalidateCoverage();previewScope.classList.remove("roi-picking");
        updateCoverageRegionMeasurements();
        roiDragStart=null;roiDragCurrent=null;schedulePreview();return;
      }
      if ($("roiLayoutMode").value === "grid" && zoomRois.length >= 6) {
        zoomRoiStatus.textContent = bi("最多可加入 6 個 ROI。", "A maximum of 6 ROIs is supported.");
        roiPickActive = false; previewScope.classList.remove("roi-picking");
        roiDragStart = null; roiDragCurrent = null; schedulePreview(); return;
      } else if ($("roiLayoutMode").value === "grid") zoomRois.push(roi);
      else zoomRois = [roi];
      zoomRoi = zoomRois[0];
      invalidateCoverage();
      $("roiZoomEnabled").checked = true; roiPickActive = false; previewScope.classList.remove("roi-picking"); updateZoomRoiStatus();
    } else (coveragePickActive?coverageRegionStatus:zoomRoiStatus).textContent = bi("選取範圍太小，請重新拖曳。", "Selection is too small. Drag again.");
    roiDragStart = null; roiDragCurrent = null; schedulePreview();
  });
  stageCanvas.addEventListener("pointercancel",(event)=>{
    if(!regionEditDrag)return;
    if(stageCanvas.hasPointerCapture(event.pointerId))stageCanvas.releasePointerCapture(event.pointerId);
    if(selectedEditRegion.kind==="coverage")coverageRegion={...regionEditDrag.original};
    else{zoomRois[selectedEditRegion.index]={...regionEditDrag.original};zoomRoi=zoomRois[0];}
    regionEditDrag=null;schedulePreview();
  });

  removeLastZoomRoiBtn.addEventListener("click", () => {
    if (generating) return;
    zoomRois.pop(); zoomRoi = zoomRois[0] || null;invalidateCoverage();setRoiEditMode(null);updateZoomRoiStatus();schedulePreview();
  });
  clearZoomRoisBtn.addEventListener("click", () => {
    if (generating) return;
    zoomRois = []; zoomRoi = null; $("roiZoomEnabled").checked = false;invalidateCoverage();setRoiEditMode(null);updateZoomRoiStatus();schedulePreview();
  });

  function alignmentScore(ref, cur, roi, dx, dy, sampleStep) {
    const x0 = Math.max(0, Math.round(roi.x * ref.width));
    const y0 = Math.max(0, Math.round(roi.y * ref.height));
    const x1 = Math.min(ref.width, Math.round((roi.x + roi.w) * ref.width));
    const y1 = Math.min(ref.height, Math.round((roi.y + roi.h) * ref.height));
    let n = 0, sr = 0, sc = 0, srr = 0, scc = 0, src = 0;
    for (let y = y0; y < y1; y += sampleStep) {
      const cy = y + dy;
      if (cy < 0 || cy >= cur.height) continue;
      for (let x = x0; x < x1; x += sampleStep) {
        const cx = x + dx;
        if (cx < 0 || cx >= cur.width) continue;
        const a = ref.gray[y * ref.width + x], b = cur.gray[cy * cur.width + cx];
        n++; sr += a; sc += b; srr += a * a; scc += b * b; src += a * b;
      }
    }
    if (n < 32) return -1;
    const covariance = src - sr * sc / n;
    const variance = Math.sqrt(Math.max(0, srr - sr * sr / n) * Math.max(0, scc - sc * sc / n));
    return variance > 1e-9 ? covariance / variance : -1;
  }

  function bestOffset(ref, cur, roi, centerX, centerY, radius, limit, sampleStep) {
    let best = {dx:0, dy:0, score:-Infinity};
    const minX = Math.max(-limit, Math.round(centerX - radius)), maxX = Math.min(limit, Math.round(centerX + radius));
    const minY = Math.max(-limit, Math.round(centerY - radius)), maxY = Math.min(limit, Math.round(centerY + radius));
    for (let dy = minY; dy <= maxY; dy++) for (let dx = minX; dx <= maxX; dx++) {
      const score = alignmentScore(ref, cur, roi, dx, dy, sampleStep);
      if (score > best.score) best = {dx, dy, score};
    }
    return best;
  }

  async function getAlignmentShift(index, img, cfg) {
    if (!cfg.alignEnabled || index <= 0) return {x:0, y:0, score:1, valid:true};
    const roi = cfg.alignmentRoi;
    roi.w = Math.min(roi.w, 1 - roi.x); roi.h = Math.min(roi.h, 1 - roi.y);
    const entry = imageEntries[index];
    const key = [entry.file.name, entry.file.size, entry.file.lastModified, cfg.maxShift, roi.x, roi.y, roi.w, roi.h].join("|");
    if (alignmentCache.has(key)) return alignmentCache.get(key);
    const reference = cfg.baselineImg || await loadImage(imageEntries[0].file);
    const coarseRef = grayscaleImage(reference, reference.width, reference.height, 280);
    const coarseCur = grayscaleImage(img, reference.width, reference.height, 280);
    const coarseLimit = Math.max(1, Math.ceil(cfg.maxShift * coarseRef.scale));
    const coarse = bestOffset(coarseRef, coarseCur, roi, 0, 0, coarseLimit, coarseLimit, 2);
    const fineRef = grayscaleImage(reference, reference.width, reference.height, 1200);
    const fineCur = grayscaleImage(img, reference.width, reference.height, 1200);
    const fineLimit = Math.max(1, Math.ceil(cfg.maxShift * fineRef.scale));
    const predictedX = coarse.dx / coarseRef.scale * fineRef.scale;
    const predictedY = coarse.dy / coarseRef.scale * fineRef.scale;
    const fineRadius = Math.max(2, Math.ceil(3 * fineRef.scale));
    const fine = bestOffset(fineRef, fineCur, roi, predictedX, predictedY, fineRadius, fineLimit, 4);
    const valid = Number.isFinite(fine.score) && fine.score >= 0.20;
    const result = valid
      ? {x:-fine.dx / fineRef.scale, y:-fine.dy / fineRef.scale, score:fine.score, valid:true}
      : {x:0, y:0, score:fine.score, valid:false};
    alignmentCache.set(key, result);
    return result;
  }

  function paintFitted(targetCtx, img, w, h, fitMode, cfg, shift = cfg.currentShift) {
    targetCtx.fillStyle = "#000"; targetCtx.fillRect(0, 0, w, h);
    const scale = fitMode === "contain" ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    targetCtx.save();
    // Preserve the v1.7 scientific-image path when all adjustments are neutral.
    // Some browsers change color/quantization behavior merely by enabling a neutral filter.
    if (cfg.upscaleFactor > 1) {
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = "high";
    }
    if (Math.abs(cfg.contrast - 100) > 0.001 || Math.abs(cfg.brightness - 100) > 0.001) {
      targetCtx.filter = `contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)`;
    }
    if (shift) targetCtx.translate((shift.x || 0) * scale, (shift.y || 0) * scale);
    targetCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    targetCtx.restore();
  }

  function paintImageMode(ctx, img, imgW, outH, cfg) {
    if (cfg.visualMode !== "difference" || !cfg.baselineImg) {
      paintFitted(ctx, img, imgW, outH, cfg.fitMode, cfg);
      return;
    }
    const currentCanvas = document.createElement("canvas");
    const baselineCanvas = document.createElement("canvas");
    currentCanvas.width = baselineCanvas.width = imgW;
    currentCanvas.height = baselineCanvas.height = outH;
    const currentCtx = currentCanvas.getContext("2d", {willReadFrequently:true});
    const baselineCtx = baselineCanvas.getContext("2d", {willReadFrequently:true});
    paintFitted(currentCtx, img, imgW, outH, cfg.fitMode, cfg);
    paintFitted(baselineCtx, cfg.baselineImg, imgW, outH, cfg.fitMode, cfg, {x:0,y:0});
    const current = currentCtx.getImageData(0, 0, imgW, outH);
    const baseline = baselineCtx.getImageData(0, 0, imgW, outH);
    for (let p = 0; p < current.data.length; p += 4) {
      current.data[p] = Math.min(255, Math.abs(current.data[p] - baseline.data[p]) * cfg.differenceGain);
      current.data[p + 1] = Math.min(255, Math.abs(current.data[p + 1] - baseline.data[p + 1]) * cfg.differenceGain);
      current.data[p + 2] = Math.min(255, Math.abs(current.data[p + 2] - baseline.data[p + 2]) * cfg.differenceGain);
      current.data[p + 3] = 255;
    }
    currentCtx.putImageData(current, 0, 0);
    ctx.save();
    if (cfg.upscaleFactor > 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    ctx.drawImage(currentCanvas, 0, 0, imgW, outH);
    ctx.restore();
  }

  function drawScaleBar(ctx, imgW, outH, cfg) {
    if (!cfg.showScaleBar) return;
    const margin = 24;
    const length = Math.min(cfg.scaleLength, Math.max(10, imgW - margin * 2));
    const atLeft = cfg.scalePosition.endsWith("left"), atTop = cfg.scalePosition.startsWith("top");
    const x1 = atLeft ? margin : imgW - margin - length, x2 = x1 + length;
    const y = atTop ? 48 : outH - 28;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = cfg.scaleThickness + 4;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.strokeStyle = cfg.scaleColor;
    ctx.lineWidth = cfg.scaleThickness;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.font = "600 17px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center"; ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.fillStyle = cfg.scaleColor;
    const labelY = atTop ? y + 26 : y - 12;
    ctx.strokeText(cfg.scaleLabel, (x1 + x2) / 2, labelY);
    ctx.fillText(cfg.scaleLabel, (x1 + x2) / 2, labelY);
    ctx.restore();
  }

  function drawAlignmentOverlay(ctx, img, imgW, outH, cfg) {
    if (!cfg.showAlignmentOverlay) return;
    const scale = cfg.fitMode === "contain" ? Math.min(imgW / img.width, outH / img.height) : Math.max(imgW / img.width, outH / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    const roi = cfg.alignmentRoi;
    const x = (imgW - dw) / 2 + roi.x * dw, y = (outH - dh) / 2 + roi.y * dh;
    const w = Math.min(roi.w, 1 - roi.x) * dw, h = Math.min(roi.h, 1 - roi.y) * dh;
    ctx.save(); ctx.strokeStyle = "#57D9C4"; ctx.lineWidth = 2; ctx.setLineDash([8,5]); ctx.strokeRect(x,y,w,h); ctx.setLineDash([]);
    ctx.font = "600 14px 'IBM Plex Mono', monospace"; ctx.fillStyle = "#57D9C4";
    const s = cfg.currentShift || {x:0,y:0,score:1};
    ctx.fillText(`ROI · Δx ${s.x.toFixed(2)} px · Δy ${s.y.toFixed(2)} px · score ${s.score.toFixed(3)}`, Math.max(8,x), Math.max(18,y-6));
    ctx.restore();
  }

  function drawScaleCalibrationOverlay(ctx, img, imgW, outH, cfg) {
    if (!cfg.previewOnly || Number(previewSlider.value) !== 0) return;
    const points = scalePickActive ? scalePickPoints : (detectedScale && detectedScale.endpoints);
    if (!points || !points.length) return;
    const sx = imgW / img.width, sy = outH / img.height;
    ctx.save(); ctx.strokeStyle = "#ff4d6d"; ctx.fillStyle = "#ff4d6d"; ctx.lineWidth = 2;
    const mapped = points.map(p => ({x:p.x * sx, y:p.y * sy}));
    mapped.forEach(p => { ctx.beginPath(); ctx.arc(p.x,p.y,5,0,Math.PI*2); ctx.fill(); });
    if (mapped.length === 2) { ctx.beginPath(); ctx.moveTo(mapped[0].x,mapped[0].y); ctx.lineTo(mapped[1].x,mapped[1].y); ctx.stroke(); }
    ctx.restore();
  }

  function drawZoomSelectionOverlay(ctx, imgW, outH, cfg) {
    if (!cfg.previewOnly) return;
    ctx.save();ctx.lineWidth=2;ctx.setLineDash([8,5]);
    const drawRegion=(region,color,fill,handles=false)=>{const x=region.x*imgW,y=region.y*outH,w=region.w*imgW,h=region.h*outH;ctx.strokeStyle=color;ctx.fillStyle=fill;ctx.beginPath();if(region.shape==="circle")ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);else ctx.rect(x,y,w,h);ctx.fill();ctx.stroke();if(handles){ctx.setLineDash([]);ctx.fillStyle=color;for(const [cx,cy] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){ctx.fillRect(cx-5,cy-5,10,10);}ctx.setLineDash([8,5]);}};
    if(coverageRegion)drawRegion(coverageRegion,"#00e5ff","rgba(0,229,255,.07)",roiEditMode==="coverage");
    if(roiEditMode==="zoom")zoomRois.forEach((region,index)=>drawRegion(region,roiColor(index,cfg),"rgba(255,255,255,.05)",selectedEditRegion?.kind==="zoom"&&selectedEditRegion.index===index));
    if((roiPickActive||coveragePickActive)&&roiDragStart&&roiDragCurrent){const region={x:Math.min(roiDragStart.x,roiDragCurrent.x),y:Math.min(roiDragStart.y,roiDragCurrent.y),w:Math.abs(roiDragCurrent.x-roiDragStart.x),h:Math.abs(roiDragCurrent.y-roiDragStart.y),shape:coveragePickActive?$("coverageRegionShape").value:"rect"};drawRegion(region,coveragePickActive?"#00e5ff":"#ffb454",coveragePickActive?"rgba(0,229,255,.12)":"rgba(255,180,84,.12)");}
    ctx.restore();
  }

  function scaledScaleLabel(label, ratio) {
    const match = String(label || "").match(/^(.*?)([-+]?\d+(?:[.,]\d+)?)(.*)$/);
    if (!match) return ratio === 1 ? label : null;
    const value = Number(match[2].replace(",", "."));
    if (!Number.isFinite(value)) return ratio === 1 ? label : null;
    const scaled = value * ratio;
    const decimals = scaled >= 10 ? 0 : (scaled >= 1 ? 1 : 2);
    return `${match[1]}${scaled.toFixed(decimals).replace(/\.0+$/, "")}${match[3]}`;
  }

  function drawRoiScaleBar(ctx, dx, dy, dw, dh, cfg, effectiveMagnification) {
    if (!cfg.showRoiScaleBar) return;
    const maxLength = Math.max(20, dw * 0.58);
    const fullLength = cfg.scaleLength * effectiveMagnification;
    const ratios = [1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.02, 0.01];
    const ratio = ratios.find(candidate => fullLength * candidate <= maxLength);
    if (!ratio) return;
    const label = scaledScaleLabel(cfg.scaleLabel, ratio);
    if (!label) return;
    const length = fullLength * ratio;
    const margin = Math.max(10, Math.min(18, dw * 0.06));
    const x2 = dx + dw - margin, x1 = x2 - length;
    const y = dy + dh - margin;
    const thickness = Math.max(2, Math.min(10, cfg.scaleThickness * Math.sqrt(effectiveMagnification)));
    const fontSize = Math.max(11, Math.min(16, dw * 0.055));
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = thickness + 4;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.strokeStyle = cfg.scaleColor; ctx.lineWidth = thickness;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.font = `600 ${fontSize}px 'IBM Plex Mono', monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.fillStyle = cfg.scaleColor; ctx.lineWidth = 3;
    ctx.strokeText(label, (x1 + x2) / 2, y - Math.max(7, thickness));
    ctx.fillText(label, (x1 + x2) / 2, y - Math.max(7, thickness));
    ctx.restore();
  }

  function renderZoomRoi(ctx, img, imgW, outH, cfg, timeMin) {
    if (!cfg.roiZoomEnabled || !cfg.zoomRoi || cfg.roiLayoutMode === "grid") return;
    const roi = cfg.zoomRoi, mag = cfg.roiMagnification;
    let dw = Math.max(100, roi.w * imgW * mag), dh = Math.max(75, roi.h * outH * mag);
    const cap = Math.min(1, imgW*.62/dw, outH*.62/dh); dw*=cap; dh*=cap;
    const effectiveMagnification = mag * cap;
    const pixelScale = cfg.upscaleFactor;
    const zoomCanvas = document.createElement("canvas"); zoomCanvas.width=Math.max(1,Math.round(dw*pixelScale)); zoomCanvas.height=Math.max(1,Math.round(dh*pixelScale));
    const zctx = zoomCanvas.getContext("2d", {willReadFrequently:cfg.visualMode==="difference"});
    zctx.imageSmoothingEnabled=true; zctx.imageSmoothingQuality="high";
    if (cfg.roiRenderMode === "match") {
      zctx.drawImage(ctx.canvas,roi.x*imgW*pixelScale,roi.y*outH*pixelScale,roi.w*imgW*pixelScale,roi.h*outH*pixelScale,0,0,zoomCanvas.width,zoomCanvas.height);
    } else {
      const shift = cfg.currentShift || {x:0,y:0};
      const sx = roi.x*img.width-shift.x, sy=roi.y*img.height-shift.y, sw=roi.w*img.width, sh=roi.h*img.height;
      if (Math.abs(cfg.contrast-100)>.001 || Math.abs(cfg.brightness-100)>.001) zctx.filter=`contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)`;
      zctx.drawImage(img,sx,sy,sw,sh,0,0,zoomCanvas.width,zoomCanvas.height); zctx.filter="none";
    }
    if (cfg.roiRenderMode === "source" && cfg.visualMode==="difference" && cfg.baselineImg) {
      const baseCanvas=document.createElement("canvas"); baseCanvas.width=zoomCanvas.width; baseCanvas.height=zoomCanvas.height;
      const bctx=baseCanvas.getContext("2d",{willReadFrequently:true}); bctx.imageSmoothingEnabled=true; bctx.imageSmoothingQuality="high";
      if (Math.abs(cfg.contrast-100)>.001 || Math.abs(cfg.brightness-100)>.001) bctx.filter=`contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)`;
      bctx.drawImage(cfg.baselineImg,roi.x*cfg.baselineImg.width,roi.y*cfg.baselineImg.height,roi.w*cfg.baselineImg.width,roi.h*cfg.baselineImg.height,0,0,baseCanvas.width,baseCanvas.height);
      const a=zctx.getImageData(0,0,zoomCanvas.width,zoomCanvas.height), b=bctx.getImageData(0,0,baseCanvas.width,baseCanvas.height);
      for(let p=0;p<a.data.length;p+=4){a.data[p]=Math.min(255,Math.abs(a.data[p]-b.data[p])*cfg.differenceGain);a.data[p+1]=Math.min(255,Math.abs(a.data[p+1]-b.data[p+1])*cfg.differenceGain);a.data[p+2]=Math.min(255,Math.abs(a.data[p+2]-b.data[p+2])*cfg.differenceGain);a.data[p+3]=255;} zctx.putImageData(a,0,0);
    }
    const margin=14, right=cfg.roiInsetPosition.endsWith("right"), bottom=cfg.roiInsetPosition.startsWith("bottom");
    const dx=right?imgW-margin-dw:margin, dy=bottom?outH-margin-dh:margin;
    ctx.save(); ctx.fillStyle="rgba(0,0,0,.85)"; ctx.fillRect(dx-5,dy-5,dw+10,dh+10); ctx.drawImage(zoomCanvas,dx,dy,dw,dh);
    ctx.strokeStyle=cfg.roiBorderColor; ctx.lineWidth=3; ctx.strokeRect(dx,dy,dw,dh);
    ctx.font="600 14px 'IBM Plex Mono', monospace"; ctx.textAlign="left"; ctx.fillStyle=cfg.roiBorderColor; ctx.strokeStyle="rgba(0,0,0,.9)"; ctx.lineWidth=3;
    const label=`ROI ×${mag.toFixed(2)} · ${cfg.roiRenderMode === "match" ? "MATCH" : "SOURCE"}`; ctx.strokeText(label,dx+7,dy+20); ctx.fillText(label,dx+7,dy+20);
    const coverage=roiCoverageAt(timeMin,0);
    if(coverage!==null){
      const detail=`ROI 1 coverage = ${coverage.toFixed(1)}%`;
      ctx.font=`600 ${Math.min(16,cfg.labelFontSize)}px 'IBM Plex Mono', monospace`;
      ctx.strokeText(detail,dx+7,dy+42,dw-14);ctx.fillText(detail,dx+7,dy+42,dw-14);
    }
    drawRoiScaleBar(ctx, dx, dy, dw, dh, cfg, effectiveMagnification);
    if(cfg.showRoiSourceBox){
      ctx.strokeStyle=cfg.roiBorderColor;ctx.lineWidth=2;ctx.setLineDash([7,4]);ctx.strokeRect(roi.x*imgW,roi.y*outH,roi.w*imgW,roi.h*outH);ctx.setLineDash([]);
      const value=roiCoverageAt(timeMin,0);
      if(value!==null){const text=`ROI 1: ${value.toFixed(1)}%`;ctx.font=`600 ${Math.min(14,cfg.labelFontSize)}px 'IBM Plex Mono', monospace`;ctx.strokeStyle="rgba(0,0,0,.9)";ctx.lineWidth=3;ctx.strokeText(text,roi.x*imgW+4,roi.y*outH+18,Math.max(20,roi.w*imgW-8));ctx.fillText(text,roi.x*imgW+4,roi.y*outH+18,Math.max(20,roi.w*imgW-8));}
    }
    ctx.restore();
  }

  function getRightPanelLayout(cfg, hasEchem, outH) {
    const gridActive = cfg.roiZoomEnabled && cfg.roiLayoutMode === "grid" && cfg.zoomRois.length > 0;
    if (!gridActive) return {gridActive:false, panelW:hasEchem ? Math.round(outH * 1.3) : 0, cells:[]};
    const panelW = Math.round(outH * 1.3), count = cfg.zoomRois.length + (hasEchem ? 1 : 0);
    const cols = count === 1 ? 1 : 2, rows = Math.ceil(count / cols), gap = 8;
    const cellW = (panelW - gap * (cols + 1)) / cols, cellH = (outH - gap * (rows + 1)) / rows;
    const cells = Array.from({length:count}, (_, i) => ({
      x:gap + (i % cols) * (cellW + gap), y:gap + Math.floor(i / cols) * (cellH + gap), w:cellW, h:cellH
    }));
    return {gridActive:true, panelW, cells, chartIndex:hasEchem ? 0 : -1, roiStart:hasEchem ? 1 : 0};
  }

  function renderRoiGridCell(ctx, img, imgW, outH, cfg, roi, cell, index, timeMin) {
    const px = cfg.upscaleFactor, header = 28, pad = 7;
    const availableW = Math.max(20, cell.w - pad * 2), availableH = Math.max(20, cell.h - header - pad * 2);
    const aspect = Math.max(.01, (roi.w * img.width) / (roi.h * img.height));
    let dw = availableW, dh = dw / aspect;
    if (dh > availableH) { dh = availableH; dw = dh * aspect; }
    const dx = cell.x + (cell.w - dw) / 2, dy = cell.y + header + (availableH - dh) / 2;
    const zoomCanvas = document.createElement("canvas");
    zoomCanvas.width = Math.max(1, Math.round(dw * px)); zoomCanvas.height = Math.max(1, Math.round(dh * px));
    const zctx = zoomCanvas.getContext("2d", {willReadFrequently:cfg.visualMode === "difference"});
    zctx.imageSmoothingEnabled = true; zctx.imageSmoothingQuality = "high";
    if (cfg.roiRenderMode === "match") {
      zctx.drawImage(ctx.canvas, roi.x * imgW * px, roi.y * outH * px, roi.w * imgW * px, roi.h * outH * px, 0, 0, zoomCanvas.width, zoomCanvas.height);
    } else {
      const shift = cfg.currentShift || {x:0,y:0};
      const sx = roi.x * img.width - shift.x, sy = roi.y * img.height - shift.y, sw = roi.w * img.width, sh = roi.h * img.height;
      if (Math.abs(cfg.contrast-100)>.001 || Math.abs(cfg.brightness-100)>.001) zctx.filter=`contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)`;
      zctx.drawImage(img, sx, sy, sw, sh, 0, 0, zoomCanvas.width, zoomCanvas.height); zctx.filter="none";
      if (cfg.visualMode === "difference" && cfg.baselineImg) {
        const base=document.createElement("canvas"); base.width=zoomCanvas.width; base.height=zoomCanvas.height;
        const bctx=base.getContext("2d",{willReadFrequently:true}); bctx.imageSmoothingEnabled=true; bctx.imageSmoothingQuality="high";
        if (Math.abs(cfg.contrast-100)>.001 || Math.abs(cfg.brightness-100)>.001) bctx.filter=`contrast(${cfg.contrast}%) brightness(${cfg.brightness}%)`;
        bctx.drawImage(cfg.baselineImg,roi.x*cfg.baselineImg.width,roi.y*cfg.baselineImg.height,roi.w*cfg.baselineImg.width,roi.h*cfg.baselineImg.height,0,0,base.width,base.height);
        const a=zctx.getImageData(0,0,zoomCanvas.width,zoomCanvas.height), b=bctx.getImageData(0,0,base.width,base.height);
        for(let p=0;p<a.data.length;p+=4){a.data[p]=Math.min(255,Math.abs(a.data[p]-b.data[p])*cfg.differenceGain);a.data[p+1]=Math.min(255,Math.abs(a.data[p+1]-b.data[p+1])*cfg.differenceGain);a.data[p+2]=Math.min(255,Math.abs(a.data[p+2]-b.data[p+2])*cfg.differenceGain);a.data[p+3]=255;} zctx.putImageData(a,0,0);
      }
    }
    ctx.save(); ctx.fillStyle="#080b0e"; ctx.fillRect(cell.x,cell.y,cell.w,cell.h); ctx.drawImage(zoomCanvas,dx,dy,dw,dh);
    const color=roiColor(index,cfg);
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.strokeRect(cell.x,cell.y,cell.w,cell.h);
    const coverage=roiCoverageAt(timeMin,index);
    ctx.font=`600 ${Math.min(15,cfg.labelFontSize)}px 'IBM Plex Mono', monospace`; ctx.textAlign="left"; ctx.fillStyle=color;
    ctx.fillText(coverage===null?`ROI ${index+1}`:`ROI ${index+1} coverage = ${coverage.toFixed(1)}%`,cell.x+8,cell.y+19,cell.w-16);
    const effectiveMagnification = dw / Math.max(1, roi.w * imgW);
    drawRoiScaleBar(ctx, dx, dy, dw, dh, cfg, effectiveMagnification);
    ctx.restore();
  }

  function renderRightPanel(ctx, img, imgW, outH, cfg, layout, hasEchem, showCurrent, currentTimeH) {
    if (!layout.gridActive) {
      if (hasEchem) Echem.drawChart(ctx,imgW,0,layout.panelW,outH,cfg.adjustedT,echemV,echemI,showCurrent,currentTimeH);
      return;
    }
    ctx.save(); ctx.translate(imgW,0); ctx.fillStyle="#05070a"; ctx.fillRect(0,0,layout.panelW,outH);
    if (hasEchem) { const c=layout.cells[layout.chartIndex]; Echem.drawChart(ctx,c.x,c.y,c.w,c.h,cfg.adjustedT,echemV,echemI,showCurrent,currentTimeH); }
    cfg.zoomRois.forEach((roi,i)=>renderRoiGridCell(ctx,img,imgW,outH,cfg,roi,layout.cells[layout.roiStart+i],i,currentTimeH*60));
    ctx.restore();
    if (cfg.showRoiSourceBox) {
      ctx.save(); ctx.lineWidth=2; ctx.setLineDash([7,4]);
      cfg.zoomRois.forEach((roi,i)=>{const color=roiColor(i,cfg),value=roiCoverageAt(currentTimeH*60,i);ctx.strokeStyle=color;ctx.strokeRect(roi.x*imgW,roi.y*outH,roi.w*imgW,roi.h*outH);ctx.fillStyle=color;ctx.font=`600 ${Math.min(14,cfg.labelFontSize)}px 'IBM Plex Mono', monospace`;const text=value===null?`ROI ${i+1}`:`ROI ${i+1}: ${value.toFixed(1)}%`;ctx.setLineDash([]);ctx.strokeStyle="rgba(0,0,0,.9)";ctx.lineWidth=3;ctx.strokeText(text,roi.x*imgW+4,roi.y*outH+16,Math.max(20,roi.w*imgW-8));ctx.fillText(text,roi.x*imgW+4,roi.y*outH+16,Math.max(20,roi.w*imgW-8));ctx.setLineDash([7,4]);ctx.lineWidth=2;});
      ctx.restore();
    }
  }

  function coverageRowAt(timeMin){
    if(!coverageResults?.rows?.length)return null;
    let best=0,diff=Infinity;
    coverageResults.rows.forEach((row,index)=>{const d=Math.abs(row.time-timeMin);if(d<diff){diff=d;best=index;}});
    return coverageResults.rows[best];
  }

  function roiCoverageAt(timeMin,index){
    const value=coverageRowAt(timeMin)?.values?.[index+1];
    return Number.isFinite(value)?value:null;
  }

  function mainCoverageLabelAt(timeMin){
    const value=coverageRowAt(timeMin)?.values?.[0];
    return Number.isFinite(value)?{text:`${bi("局部主圖 coverage","Local coverage")} = ${value.toFixed(1)}%`,color:coverageResults.series[0].color}:null;
  }

  function drawMainLabels(ctx,labels,cfg,imgW,outH){
    const size=cfg.labelFontSize,lineHeight=Math.ceil(size*1.3)+2;
    ctx.save();ctx.font=`600 ${size}px 'IBM Plex Mono', monospace`;ctx.lineWidth=Math.max(2,size/4);ctx.textAlign="left";
    labels.forEach((label,index)=>{const y=14+size+index*lineHeight;ctx.strokeStyle="rgba(0,0,0,.85)";ctx.fillStyle=label.color;ctx.strokeText(label.text,16,y,Math.max(30,imgW-26));ctx.fillText(label.text,16,y,Math.max(30,imgW-26));});
    if(cfg.visualMode==="difference"){
      const text=`|image − first| × ${cfg.differenceGain}`;ctx.strokeStyle="rgba(0,0,0,.85)";ctx.fillStyle="#FF6B6B";
      ctx.strokeText(text,16,outH-18,Math.max(30,imgW-26));ctx.fillText(text,16,outH-18,Math.max(30,imgW-26));
    }
    ctx.restore();
  }

  function drawComposedFrame(ctx, img, entry, cfg) {
    const hasEchem = cfg.adjustedT.length > 0 && echemV.length > 0;
    const imgAspect = img.width / img.height;
    const imgW = Math.round(cfg.outH * imgAspect);
    const rightLayout = getRightPanelLayout(cfg, hasEchem, cfg.outH);
    const totalW = imgW + rightLayout.panelW;
    const pixelScale = cfg.upscaleFactor;
    if (stageCanvas.width !== totalW * pixelScale || stageCanvas.height !== cfg.outH * pixelScale) {
      stageCanvas.width = totalW * pixelScale; stageCanvas.height = cfg.outH * pixelScale;
    }
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    if (pixelScale > 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, totalW, cfg.outH);
    paintImageMode(ctx, img, imgW, cfg.outH, cfg);
    drawCoverageMask(ctx,imgW,cfg.outH,entry.minute+cfg.imageOffsetMin);
    renderZoomRoi(ctx, img, imgW, cfg.outH, cfg, entry.minute+cfg.imageOffsetMin);
    drawAlignmentOverlay(ctx, img, imgW, cfg.outH, cfg);
    drawScaleCalibrationOverlay(ctx, img, imgW, cfg.outH, cfg);
    drawZoomSelectionOverlay(ctx, imgW, cfg.outH, cfg);
    const currentTimeH = (entry.minute + cfg.imageOffsetMin) / 60;
    let nearestIdx = 0, nearestDiff = Infinity;
    if (hasEchem) cfg.adjustedT.forEach((value, idx) => { const d = Math.abs(value - currentTimeH); if (d < nearestDiff) { nearestDiff = d; nearestIdx = idx; } });
    const labels = [];
    if (cfg.showTime) labels.push({text:`t = ${(entry.minute + cfg.imageOffsetMin).toFixed(1)} min`, color:"#fff"});
    const mainCoverage=mainCoverageLabelAt(entry.minute + cfg.imageOffsetMin);
    if(mainCoverage)labels.push(mainCoverage);
    if (hasEchem) labels.push({text:`Ewe = ${echemV[nearestIdx].toFixed(3)} V`, color:"#FFB454"});
    if(hasEchem&&$("showCurrent").checked&&echemI&&Number.isFinite(echemI[nearestIdx]))labels.push({text:`I = ${echemI[nearestIdx].toFixed(3)} mA`,color:"#57D9C4"});
    if (cfg.annotation) labels.push({text:cfg.annotation, color:"#57D9C4"});
    drawMainLabels(ctx,labels,cfg,imgW,cfg.outH);
    const showCurrent = hasEchem && $("showCurrent").checked && !!echemI;
    renderRightPanel(ctx,img,imgW,cfg.outH,cfg,rightLayout,hasEchem,showCurrent,currentTimeH);
    drawScaleBar(ctx, imgW, cfg.outH, cfg);
    const shift = cfg.currentShift || {x:0,y:0,score:1};
    readout.innerHTML = `<span>frame ${Number(previewSlider.value) + 1}/${imageEntries.length}</span><span>t = <b>${(entry.minute + cfg.imageOffsetMin).toFixed(1)}</b> min</span>` + (hasEchem ? `<span>Ewe = <b>${echemV[nearestIdx].toFixed(3)}</b> V</span>` : "") + (cfg.alignEnabled ? `<span>Δx=<b>${shift.x.toFixed(2)}</b>, Δy=<b>${shift.y.toFixed(2)}</b> px</span>` : "");
    return {totalW, currentTimeH, nearestIdx};
  }

  async function updatePreview(requestId = ++previewRequestId) {
    if (!imageEntries.length || generating) return;
    const idx = Math.min(imageEntries.length - 1, Math.max(0, parseInt(previewSlider.value, 10) || 0));
    try {
      const img = await loadImage(imageEntries[idx].file);
      if (requestId !== previewRequestId || generating) return;
      const cfg = frameSettings();
      cfg.previewOnly = true;
      cfg.showAlignmentOverlay = previewVisualMode === "aligned";
      cfg.visualMode = previewVisualMode === "difference" ? "difference" : "original";
      if (cfg.visualMode === "difference" || cfg.alignEnabled || cfg.showAlignmentOverlay) cfg.baselineImg = idx === 0 ? img : await loadImage(imageEntries[0].file);
      if (cfg.alignEnabled) cfg.currentShift = await getAlignmentShift(idx, img, cfg);
      if (requestId !== previewRequestId || generating) return;
      if (cfg.alignEnabled) {
        const s = cfg.currentShift;
        alignmentReadout.textContent = s.valid
          ? bi(`目前影格：Δx ${s.x.toFixed(2)} px，Δy ${s.y.toFixed(2)} px，相似度 ${s.score.toFixed(3)}`, `Current frame: Δx ${s.x.toFixed(2)} px, Δy ${s.y.toFixed(2)} px, score ${s.score.toFixed(3)}`)
          : bi(`目前影格：對齊可信度過低（${s.score.toFixed(3)}），未套用位移`, `Current frame: alignment confidence too low (${s.score.toFixed(3)}); no shift applied`);
      } else alignmentReadout.textContent = t("alignmentNotMeasured");
      stageCanvas.style.display = "block"; scopeEmpty.style.display = "none";
      drawComposedFrame(stageCanvas.getContext("2d"), img, imageEntries[idx], cfg);
      preloadAround(idx);
    } catch (err) {
      if (requestId === previewRequestId) log(`${currentLanguage === "en" ? "[Error]" : "[錯誤]"} ${err.message}`, "err");
    }
  }

  function schedulePreview() {
    previewRequestId++;
    const requestId = previewRequestId;
    if (previewAnimationFrame) cancelAnimationFrame(previewAnimationFrame);
    previewAnimationFrame = requestAnimationFrame(() => {
      previewAnimationFrame = 0;
      updatePreview(requestId);
    });
  }
  previewBtn.addEventListener("click", schedulePreview);
  previewSlider.addEventListener("input", schedulePreview);
  function stepPreviewIndex(current,delta,count){
    return Math.max(0,Math.min(count-1,current+delta));
  }
  document.addEventListener("keydown",event=>{
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||$("changelogOverlay").classList.contains("open"))return;
    const key=event.key.toLowerCase(),target=event.target;
    if((key==="j"||key==="l")&&!event.shiftKey){
      if(target!==workflowSection&&target!==previewSlider&&target?.closest?.("input, textarea, select, [contenteditable], [role='textbox']"))return;
      if(generating||previewSlider.disabled||!imageEntries.length)return;
      event.preventDefault();
      const next=stepPreviewIndex(Number(previewSlider.value),key==="j"?-1:1,imageEntries.length);
      if(next!==Number(previewSlider.value)){previewSlider.value=String(next);schedulePreview();}
      return;
    }
    if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
    if(target?.closest?.("input, textarea, select, [contenteditable], [role='textbox']"))return;
    if(nudgeSelectedRoi(event.key,event.shiftKey?10:1))event.preventDefault();
  });
  previewModeTabs.forEach((tab) => tab.addEventListener("click", () => {
    previewVisualMode = tab.dataset.previewMode;
    previewModeTabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    schedulePreview();
  }));
  ["imageOffset","echemOffset","fitMode","upscaleFactor","differenceGain","showScaleBar","scaleValue","scaleUnit","scaleLength","scaleThickness","scalePosition","scaleColor","alignEnabled","maxShift","roiX","roiY","roiW","roiH","roiZoomEnabled","roiLayoutMode","roiRenderMode","roiMagnification","roiInsetPosition","roiBorderColor","showRoiSourceBox","showRoiScaleBar","sampleName","labelFontSize","showTime","outH","showCurrent","showCoverageMask","coverageMaskColor","coverageMaskOpacity"].forEach((id) => $(id).addEventListener("change", () => {
    if (["maxShift","roiX","roiY","roiW","roiH"].includes(id)) alignmentCache.clear();
    if (id === "outH") syncCalibratedScaleLength();
    if(id==="coverageMaskColor"&&coverageResults){coverageResults.series[0].color=$("coverageMaskColor").value;drawCoverageChart(coverageResults);}
    schedulePreview();
  }));
  $("scaleLength").addEventListener("input", () => {
    if (document.activeElement !== $("scaleLength")) return;
    detectedScale = null;
    updateCoverageRegionMeasurements();
    scaleCalibrationStatus.textContent = t("scaleNotCalibrated");
  });
  $("scaleValue").addEventListener("input",()=>{updateCoverageRegionMeasurements();invalidateCoverage();schedulePreview();});
  $("scaleUnit").addEventListener("change",()=>{updateCoverageRegionMeasurements();invalidateCoverage();});
  $("labelFontSize").addEventListener("input",schedulePreview);
  $("coverageMaskOpacity").addEventListener("input",schedulePreview);
  $("coverageRegionShape").addEventListener("change",()=>{if(coverageRegion){coverageRegion.shape=$("coverageRegionShape").value;invalidateCoverage();updateCoverageRegionMeasurements();}schedulePreview();});

  function filteredDifferenceMask(base, current, width, height, threshold, minArea) {
    const mask=new Uint8Array(width*height), seen=new Uint8Array(width*height);
    for(let i=0;i<mask.length;i++) if(Math.abs(current[i]-base[i])>=threshold) mask[i]=1;
    const output=new Uint8Array(mask.length), stack=[];
    for(let start=0;start<mask.length;start++){
      if(!mask[start]||seen[start]) continue;
      const component=[]; stack.push(start); seen[start]=1;
      while(stack.length){const p=stack.pop();component.push(p);const x=p%width,y=(p/width)|0;
        if(x>0){const q=p-1;if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
        if(x+1<width){const q=p+1;if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
        if(y>0){const q=p-width;if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
        if(y+1<height){const q=p+width;if(mask[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
      }
      if(component.length>=minArea) component.forEach(p=>{output[p]=1;});
    }
    return output;
  }

  function grayForCoverage(img,width,height,shift,sourceScale){
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#000";ctx.fillRect(0,0,width,height);
    ctx.drawImage(img,(shift?.x||0)*sourceScale,(shift?.y||0)*sourceScale,width,height);
    const data=ctx.getImageData(0,0,width,height).data,gray=new Uint8Array(width*height);
    for(let p=0,q=0;p<data.length;p+=4,q++) gray[q]=Math.round(data[p]*.299+data[p+1]*.587+data[p+2]*.114);
    return gray;
  }

  function electrodeAreaCm2(){
    const diameter=Math.max(.01,Number(electrodeDiameterCm.value)||.9);
    return Math.PI*Math.pow(diameter/2,2);
  }

  function updateElectrodeAreaReadout(){
    electrodeAreaReadout.value=electrodeAreaCm2().toFixed(4);
  }

  function integrateCapacity(timesH,currentsMa){
    if(!timesH.length||timesH.length!==currentsMa.length)return null;
    const signed=[0],absolute=[0];
    for(let idx=1;idx<timesH.length;idx++){
      const dt=timesH[idx]-timesH[idx-1],a=Number(currentsMa[idx-1]),b=Number(currentsMa[idx]);
      if(!(dt>=0&&Number.isFinite(a)&&Number.isFinite(b)))return null;
      signed.push(signed[idx-1]+(a+b)*.5*dt);
      absolute.push(absolute[idx-1]+(Math.abs(a)+Math.abs(b))*.5*dt);
    }
    return {signed,absolute};
  }

  function interpolateSeries(xs,ys,x){
    if(!xs.length||x<xs[0]||x>xs[xs.length-1])return null;
    let lo=0,hi=xs.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(xs[mid]<=x)lo=mid;else hi=mid;}
    if(xs[lo]===x||lo===hi)return ys[lo];
    const span=xs[hi]-xs[lo];return span?ys[lo]+(ys[hi]-ys[lo])*(x-xs[lo])/span:ys[lo];
  }

  function pointInsideCoverageRegion(x,y,region,width,height){
    const nx=(x+.5)/width,ny=(y+.5)/height;
    if(nx<region.x||nx>region.x+region.w||ny<region.y||ny>region.y+region.h)return false;
    if(region.shape!=="circle")return true;
    const dx=(nx-(region.x+region.w/2))/(region.w/2),dy=(ny-(region.y+region.h/2))/(region.h/2);
    return dx*dx+dy*dy<=1;
  }

  function encodeMaskRuns(mask,width,height){
    const runs=[];
    for(let y=0;y<height;y++){let x=0;while(x<width){while(x<width&&!mask[y*width+x])x++;if(x>=width)break;const start=x;while(x<width&&mask[y*width+x])x++;runs.push(y,start,x-start);}}
    return runs;
  }

  function drawCoverageMask(ctx,imgW,outH,timeMin){
    if(!coverageResults?.rows?.length||!$("showCoverageMask").checked)return;
    let best=0,diff=Infinity;coverageResults.rows.forEach((row,index)=>{const d=Math.abs(row.time-timeMin);if(d<diff){diff=d;best=index;}});
    const runs=coverageResults.rows[best].maskRuns;if(!runs)return;
    const sx=imgW/coverageResults.maskWidth,sy=outH/coverageResults.maskHeight,path=new Path2D();
    for(let i=0;i<runs.length;i+=3)path.rect(runs[i+1]*sx,runs[i]*sy,runs[i+2]*sx,sy+.35);
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(100,Number($("coverageMaskOpacity").value)||0))/100;ctx.fillStyle=$("coverageMaskColor").value;ctx.fill(path);ctx.restore();
  }

  // Fit C0 + amplitude * (1 - exp(-((t - lag)/tau)^n)) to the
  // local-main-image coverage. For fixed nonlinear parameters the two
  // remaining coefficients are solved by ordinary least squares.
  function fitAvramiCoverage(rows,endTime){
    const samples=rows.filter(r=>Number.isFinite(r.time)&&r.time<=endTime&&Number.isFinite(r.values[0]));
    if(samples.length<12||samples.at(-1).time-samples[0].time<10)return null;
    const xs=samples.map(r=>r.time),ys=samples.map(r=>r.values[0]);
    const maxTime=xs.at(-1),minTime=xs[0],span=maxTime-minTime;
    function evaluate(p){
      const [lag,tau,n]=p;
      if(!(lag>=minTime&&lag<=maxTime-5&&tau>=1&&tau<=span*8&&n>=.15&&n<=5))return null;
      let sumZ=0,sumY=0,sumZZ=0,sumZY=0;
      const basis=xs.map(x=>-Math.expm1(-Math.pow(Math.max(0,x-lag)/tau,n)));
      for(let i=0;i<xs.length;i++){const z=basis[i];sumZ+=z;sumY+=ys[i];sumZZ+=z*z;sumZY+=z*ys[i];}
      const count=xs.length,denom=count*sumZZ-sumZ*sumZ;
      if(denom<1e-8)return null;
      let amplitude=(count*sumZY-sumZ*sumY)/denom;
      let baseline=(sumY-amplitude*sumZ)/count;
      baseline=Math.max(-2,Math.min(15,baseline));
      amplitude=Math.max(0,Math.min(150,(sumZY-baseline*sumZ)/sumZZ));
      let ss=0;for(let i=0;i<count;i++)ss+=(baseline+amplitude*basis[i]-ys[i])**2;
      return {score:ss/count,baseline,amplitude,lag,tau,n};
    }
    let best=null;
    for(const lag0 of [minTime,minTime+span*.025,minTime+span*.05,minTime+span*.1,minTime+span*.2]){
      for(const n0 of [.5,1,1.5]){
        let p=[lag0,Math.max(2,span*.12),n0],current=evaluate(p);
        if(!current)continue;
        let steps=[Math.max(4,span*.04),Math.max(5,span*.1),.3];
        for(let iter=0;iter<110;iter++){
          let improved=false;
          for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
            const trial=p.slice();trial[axis]+=sign*steps[axis];const candidate=evaluate(trial);
            if(candidate&&candidate.score<current.score-1e-12){p=trial;current=candidate;improved=true;}
          }
          if(!improved){steps=steps.map(v=>v*.55);if(steps[0]<.015&&steps[1]<.02&&steps[2]<.0002)break;}
        }
        if(!best||current.score<best.score)best=current;
      }
    }
    return best?{...best,rmse:Math.sqrt(best.score),endTime:maxTime}:null;
  }

  function clearAvramiEquation(){
    avramiEquation.value="";
    avramiEquationStatus.textContent="";
    copyAvramiEquationBtn.disabled=true;
  }

  function formatAvramiEquation(fit){
    const number=value=>Number(value.toPrecision(8)).toString();
    return `C(t) = ${number(fit.baseline)} + ${number(fit.amplitude)} × [1 − exp(−(max(t − ${number(fit.lag)}, 0) / ${number(fit.tau)})^${number(fit.n)})]\n`+
      `t: min; C(t): optical-change coverage (%); fit: t ≤ ${number(fit.endTime)} min; RMSE: ${number(fit.rmse)} percentage points`;
  }

  copyAvramiEquationBtn.addEventListener("click",async()=>{
    if(!avramiEquation.value)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(avramiEquation.value);
      else{avramiEquation.select();if(!document.execCommand("copy"))throw new Error("Copy unavailable");}
      avramiEquationStatus.textContent=t("avramiEquationCopied");
    }catch(error){
      try{avramiEquation.select();if(!document.execCommand("copy"))throw error;avramiEquationStatus.textContent=t("avramiEquationCopied");}
      catch{avramiEquationStatus.textContent=t("avramiEquationCopyFailed");}
    }
  });

  function updateAvramiFit(){
    if(!coverageResults)return;
    const requested=Number($("avramiFitEnd").value);
    coverageResults.avramiFit=$("showAvramiFit").checked&&Number.isFinite(requested)&&requested>0
      ?fitAvramiCoverage(coverageResults.rows,requested):null;
    clearAvramiEquation();
    if(coverageResults.avramiFit){
      avramiEquation.value=formatAvramiEquation(coverageResults.avramiFit);
      copyAvramiEquationBtn.disabled=false;
    }else if($("showAvramiFit").checked){avramiEquationStatus.textContent=t("avramiEquationInsufficient");}
    drawCoverageChart(coverageResults);
  }

  function drawCoverageChart(results){
    coverageOutputPanel.hidden=false;
    const ctx=coverageChart.getContext("2d"),w=coverageChart.width,h=coverageChart.height,m={l:58,r:20,t:28,b:48};
    ctx.fillStyle="#080b0e";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#31404b";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(m.l,m.t);ctx.lineTo(m.l,h-m.b);ctx.lineTo(w-m.r,h-m.b);ctx.stroke();
    let mode=coverageXAxis.value;if(mode!=="time"&&!results.capacityAvailable){mode="time";coverageXAxis.value="time";}
    const axis=mode==="signedCapacity"?{key:"signedArealCapacity",label:"Signed areal capacity (mAh cm⁻²)"}:mode==="absoluteCapacity"?{key:"absoluteArealCapacity",label:"Cumulative charge throughput (mAh cm⁻²)"}:{key:"time",label:"Time (min)"};
    ctx.fillStyle="#b7c4ce";ctx.font="13px 'IBM Plex Mono', monospace";ctx.textAlign="center";ctx.fillText(axis.label,(m.l+w-m.r)/2,h-12);
    ctx.save();ctx.translate(15,(m.t+h-m.b)/2);ctx.rotate(-Math.PI/2);ctx.fillText("Optical-change coverage (%)",0,0);ctx.restore();
    const times=results.rows.map(r=>r[axis.key]),finite=times.filter(Number.isFinite),xmin=Math.min(...finite),xmax=Math.max(...finite);
    if(finite.length){
      const span=xmax-xmin,steps=5,range=span>0?span:Math.max(1,Math.abs(xmin)),tickDecimals=mode==="time"?(range<1?2:range<10?1:0):range<0.01?4:range<0.1?3:range<1?2:range<10?1:0;
      ctx.textAlign="center";ctx.textBaseline="top";ctx.fillStyle="#aebbc5";
      for(let i=0;i<=steps;i++){
        const x=m.l+i/steps*(w-m.l-m.r),value=span>0?xmin+span*i/steps:xmin;
        ctx.fillText(value.toFixed(tickDecimals),x,h-m.b+8);
        ctx.strokeStyle="#84939e";ctx.beginPath();ctx.moveTo(x,h-m.b);ctx.lineTo(x,h-m.b+5);ctx.stroke();
      }
      ctx.textBaseline="alphabetic";
    }
    [0,25,50,75,100].forEach(v=>{const y=h-m.b-v/100*(h-m.t-m.b);ctx.fillStyle="#84939e";ctx.textAlign="right";ctx.fillText(String(v),m.l-8,y+4);ctx.strokeStyle="rgba(120,140,150,.18)";ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(w-m.r,y);ctx.stroke();});
    results.series.forEach((s,si)=>{ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.beginPath();let started=false;s.values.forEach((v,i)=>{if(!Number.isFinite(times[i])){started=false;return;}const x=m.l+(times[i]-xmin)/Math.max(1e-9,xmax-xmin)*(w-m.l-m.r),y=h-m.b-v/100*(h-m.t-m.b);if(started)ctx.lineTo(x,y);else{ctx.moveTo(x,y);started=true;}});ctx.stroke();ctx.fillStyle=s.color;ctx.textAlign="left";ctx.fillText(s.label,m.l+8+si*105,m.t-8);});
    const fit=results.avramiFit;
    if(fit){
      ctx.save();ctx.strokeStyle="#ffffff";ctx.lineWidth=2.5;ctx.setLineDash([8,5]);ctx.beginPath();let started=false;
      results.rows.forEach((row,i)=>{if(row.time>fit.endTime||!Number.isFinite(times[i]))return;
        const basis=-Math.expm1(-Math.pow(Math.max(0,row.time-fit.lag)/fit.tau,fit.n));
        const coverage=fit.baseline+fit.amplitude*basis;
        const px=m.l+(times[i]-xmin)/Math.max(1e-9,xmax-xmin)*(w-m.l-m.r),py=h-m.b-coverage/100*(h-m.t-m.b);
        if(started)ctx.lineTo(px,py);else{ctx.moveTo(px,py);started=true;}
      });ctx.stroke();ctx.restore();ctx.fillStyle="#ffffff";ctx.textAlign="right";
      ctx.fillText(`Avrami  n=${fit.n.toFixed(2)}  RMSE=${fit.rmse.toFixed(2)} pp  (≤${fit.endTime} min)`,w-m.r,h-m.b-12);
    }
  }

  async function runCoverageAnalysis(){
    if(generating||!imageEntries.length){coverageStatus.textContent=t("chooseImagesFirst");return;}
    if(!coverageRegion){coverageStatus.textContent=bi("请先在第一张图选择 Coverage analysis region。","Select a coverage analysis region on the first image first.");return;}
    runCoverageAnalysisBtn.disabled=true;downloadCoverageCsvBtn.disabled=true;coverageResults=null;coverageOutputPanel.hidden=true;clearAvramiEquation();
    try{
      const first=await loadImage(imageEntries[0].file),scale=Math.min(1,480/Math.max(first.width,first.height));
      const width=Math.max(1,Math.round(first.width*scale)),height=Math.max(1,Math.round(first.height*scale));
      const base=grayForCoverage(first,width,height,{x:0,y:0},scale);
      const threshold=Math.max(1,Math.min(255,parseInt($("coverageThreshold").value,10)||25));
      const minSource=Math.max(1,parseInt($("coverageMinArea").value,10)||20),minArea=Math.max(1,Math.round(minSource*scale*scale));
      const rois=[{...coverageRegion},...zoomRois.map(r=>({...r}))];
      const labels=[bi("局部主图","Local main image"),...zoomRois.map((_,i)=>`ROI ${i+1}`)];
      const series=labels.map((label,i)=>({label,color:i===0?$("coverageMaskColor").value:ROI_COLORS[(i-1)%ROI_COLORS.length],values:[]}));
      const calibrated=!!detectedScale,unit=$("scaleUnit").value,value=parseFloat($("scaleValue").value)||100;
      const unitAreaPerSourcePixel=calibrated?Math.pow(value/detectedScale.sourcePixels,2):null;
      const rows=[],cfg=frameSettings(),areaCm2=electrodeAreaCm2(),capacity=integrateCapacity(cfg.adjustedT,echemI),capacityAvailable=!!capacity;
      for(let idx=0;idx<imageEntries.length;idx++){
        const img=idx===0?first:await loadImage(imageEntries[idx].file);
        const shift=cfg.alignEnabled?await getAlignmentShift(idx,img,cfg):{x:0,y:0};
        const current=grayForCoverage(img,width,height,shift,scale),mask=filteredDifferenceMask(base,current,width,height,threshold,minArea);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!pointInsideCoverageRegion(x,y,coverageRegion,width,height))mask[y*width+x]=0;
        const values=[],areas=[];
        rois.forEach((roi,ri)=>{const x0=Math.max(0,Math.floor(roi.x*width)),y0=Math.max(0,Math.floor(roi.y*height)),x1=Math.min(width,Math.ceil((roi.x+roi.w)*width)),y1=Math.min(height,Math.ceil((roi.y+roi.h)*height));let count=0,total=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){if(!pointInsideCoverageRegion(x,y,coverageRegion,width,height)||!pointInsideCoverageRegion(x,y,roi,width,height))continue;total++;count+=mask[y*width+x];}const pct=total?count/total*100:0;values.push(pct);series[ri].values.push(pct);areas.push(calibrated?count/(scale*scale)*unitAreaPerSourcePixel:null);});
        const time=imageEntries[idx].minute+cfg.imageOffsetMin,timeH=time/60,signed=capacity?interpolateSeries(cfg.adjustedT,capacity.signed,timeH):null,absolute=capacity?interpolateSeries(cfg.adjustedT,capacity.absolute,timeH):null;
        rows.push({time,signedArealCapacity:Number.isFinite(signed)?signed/areaCm2:null,absoluteArealCapacity:Number.isFinite(absolute)?absolute/areaCm2:null,values,areas,maskRuns:encodeMaskRuns(mask,width,height)});coverageStatus.textContent=bi(`分析中 ${idx+1}/${imageEntries.length}`,`Analyzing ${idx+1}/${imageEntries.length}`);if(idx%4===0)await new Promise(r=>setTimeout(r,0));
      }
      // Keep a snapshot of the settings actually used. Users may change controls
      // after analyzing, before downloading the CSV.
      coverageResults={rows,series,labels,unit,calibrated,threshold,minSource,
        electrodeDiameterCm:Math.max(.01,Number(electrodeDiameterCm.value)||.9),
        region:{...coverageRegion},roiRegions:rois.map(roi=>({...roi})),
        sourceWidth:first.width,sourceHeight:first.height,
        scaleValue:calibrated?value:null,scaleSourcePixels:calibrated?detectedScale.sourcePixels:null,
        imageOffsetMin:cfg.imageOffsetMin,alignmentEnabled:cfg.alignEnabled,
        capacityAvailable,electrodeAreaCm2:areaCm2,maskWidth:width,maskHeight:height};updateAvramiFit();downloadCoverageCsvBtn.disabled=false;
      coverageStatus.textContent=bi(`完成：${rows.length} 張影像，${labels.length} 個分析區域。${capacityAvailable?`已用 ${areaCm2.toFixed(4)} cm² 計算面容量。`:"未偵測到可積分的 ECHEM 電流，X 軸僅能使用時間。"}`,`Complete: ${rows.length} frames, ${labels.length} region(s). ${capacityAvailable?`Areal capacity calculated using ${areaCm2.toFixed(4)} cm².`:"No integrable ECHEM current was detected; only time is available for the X axis."}`);schedulePreview();
    }catch(err){coverageStatus.textContent=bi(`分析失敗：${err.message}`,`Analysis failed: ${err.message}`);}finally{runCoverageAnalysisBtn.disabled=false;}
  }

  runCoverageAnalysisBtn.addEventListener("click",runCoverageAnalysis);
  electrodeDiameterCm.addEventListener("input",updateElectrodeAreaReadout);
  coverageXAxis.addEventListener("change",()=>{if(coverageResults)drawCoverageChart(coverageResults);});
  $("showAvramiFit").addEventListener("change",updateAvramiFit);
  $("avramiFitEnd").addEventListener("change",updateAvramiFit);
  updateElectrodeAreaReadout();
  downloadCoverageCsvBtn.addEventListener("click",()=>{
    if(!coverageResults)return;const r=coverageResults;
    // Append settings after the existing data columns to keep old CSV readers working.
    const settingNames=["change_threshold_0_255","minimum_connected_area_source_px2","electrode_diameter_cm","electrode_area_cm2","image_time_offset_min","alignment_enabled","source_image_width_px","source_image_height_px","scale_bar_value","scale_bar_unit","scale_bar_length_source_px",...r.roiRegions.flatMap((_,i)=>{const prefix=i===0?"analysis_region":`roi_${i}`;return [`${prefix}_shape`,`${prefix}_x_source_px`,`${prefix}_y_source_px`,`${prefix}_width_source_px`,`${prefix}_height_source_px`];})];
    const regionSettings=r.roiRegions.flatMap(roi=>[roi.shape,roi.x*r.sourceWidth,roi.y*r.sourceHeight,roi.w*r.sourceWidth,roi.h*r.sourceHeight]);
    const settingValues=[r.threshold,r.minSource,r.electrodeDiameterCm,r.electrodeAreaCm2,r.imageOffsetMin,r.alignmentEnabled?1:0,r.sourceWidth,r.sourceHeight,r.scaleValue??"",r.calibrated?r.unit:"",r.scaleSourcePixels??"",...regionSettings];
    const head=["time_min",...(r.capacityAvailable?["signed_areal_capacity_mAh_cm2","absolute_throughput_mAh_cm2"]:[]),...r.labels.map(x=>`${x}_coverage_percent`),...(r.calibrated?r.labels.map(x=>`${x}_area_${r.unit}2`):[]),...settingNames];
    const lines=[head.join(","),...r.rows.map(row=>[row.time,...(r.capacityAvailable?[row.signedArealCapacity?.toFixed(8)??"",row.absoluteArealCapacity?.toFixed(8)??""]:[]),...row.values.map(v=>v.toFixed(6)),...(r.calibrated?row.areas.map(v=>v.toFixed(6)):[]),...settingValues].join(","))];
    const blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="li_optical_change_coverage.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });

  function bindRangeAndNumber(rangeId, numberId, min, max) {
    const range = $(rangeId), number = $(numberId);
    const clamp = (value) => Math.max(min, Math.min(max, value));
    range.addEventListener("input", () => {
      number.value = Number(range.value).toFixed(2);
      schedulePreview();
    });
    number.addEventListener("input", () => {
      const parsed = Number(number.value);
      if (!Number.isFinite(parsed)) return;
      range.value = String(clamp(parsed));
      schedulePreview();
    });
    number.addEventListener("change", () => {
      const parsed = Number(number.value);
      const value = clamp(Number.isFinite(parsed) ? parsed : 100);
      number.value = value.toFixed(2);
      range.value = String(value);
      schedulePreview();
    });
  }
  bindRangeAndNumber("contrastRange", "contrastValue", 0, 300);
  bindRangeAndNumber("brightnessRange", "brightnessValue", 0, 200);
  cancelBtn.addEventListener("click", () => { if (generating) { cancelRequested = true; cancelBtn.disabled = true; log(bi("正在取消…", "Canceling…"), "warn"); } });

  // ---------- main generation ----------
  genBtn.addEventListener("click", async () => {
    if (generating) return;
    if (imageEntries.length === 0) {
      log(t("chooseImagesFirst"), "err");
      return;
    }

    generating = true;
    cancelRequested = false;
    genBtn.disabled = true;
    previewBtn.disabled = true;
    cancelBtn.disabled = false;
    resetBtn.disabled = true;
    setStatus("busy", t("statusBusy"));
    progFill.style.width = "0%";
    log(t("start"), "ok");

    previewRequestId++;
    const lockedControls = [...document.querySelectorAll("input, select")].map(el => [el, el.disabled]);
    lockedControls.forEach(([el]) => { el.disabled = true; });
    let activeEncoder = null;
    try {
      const fps = Math.min(120, Math.max(1, parseInt($("fps").value, 10) || 8));
      const secondsPerImage = Math.max(0.01, parseFloat($("frameDuration").value) || 0.5);
      const cfg = frameSettings();
      const outH = cfg.outH;
      const pixelScale = cfg.upscaleFactor;
      const adjustedT = cfg.adjustedT;
      const hasEchem = echemT.length > 0 && echemV.length > 0;
      const showCurrent = hasEchem && $("showCurrent").checked && !!echemI;
      if (hasEchem && $("showCurrent").checked && !echemI) {
        log(bi("[警告] 找不到電流欄位，將只顯示電壓曲線", "[Warning] No current column was found; only the voltage curve will be shown."), "warn");
      }
      log(hasEchem ? t("modeBoth") : t("modeImage"), "ok");

      // Validate once so both modes use the same ordered set of source images.
      const exportEntries = [];
      for (const entry of [...imageEntries]) {
        if (cancelRequested) break;
        try { await loadImage(entry.file); exportEntries.push(entry); }
        catch (err) { log(err.message, "warn"); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (cancelRequested) { setStatus("ready", bi("已取消", "Canceled")); return; }
      if (!exportEntries.length) throw new Error(bi("沒有可解碼的圖片", "No decodable images"));
      log(bi(`固定影片長度：${(exportEntries.length * secondsPerImage).toFixed(3)} 秒`,
        `Fixed video duration: ${(exportEntries.length * secondsPerImage).toFixed(3)} seconds`));
      const selectedOutputMode = cfg.visualMode;
      const outputModes = selectedOutputMode === "both" ? ["original", "difference"] : [selectedOutputMode];
      for (let outputIndex = 0; outputIndex < outputModes.length; outputIndex++) {
        cfg.visualMode = outputModes[outputIndex];
        progFill.style.width = "0%";
        progText.textContent = outputModes.length > 1
          ? bi(`正在生成 ${outputIndex + 1}/${outputModes.length}：${cfg.visualMode === "original" ? "原始影片" : "差分影片"}`, `Generating ${outputIndex + 1}/${outputModes.length}: ${cfg.visualMode === "original" ? "original video" : "difference video"}`)
          : t("notStarted");
        log(bi(`── ${cfg.visualMode === "original" ? "原始影片" : "差分影片"} ──`, `── ${cfg.visualMode === "original" ? "Original video" : "Difference video"} ──`), "ok");

      // 依序嘗試找出第一張「瀏覽器讀得懂」的圖片，用來決定畫面尺寸
      const firstLoadable = await findFirstLoadable(exportEntries);
      if (!firstLoadable) {
        throw new Error(bi("所有圖片都無法被瀏覽器解碼。請改用標準 JPG/PNG/WebP，或使用支援顯微鏡格式的桌面工具。", "None of the images could be decoded. Use standard JPG/PNG/WebP files or a desktop tool that supports microscopy formats."));
      }
      const firstImg = firstLoadable.img;
      cfg.baselineImg = firstImg;
      const imgAspect = firstImg.width / firstImg.height;
      const imgW = Math.round(outH * imgAspect);
      const rightLayout = getRightPanelLayout(cfg, hasEchem, outH);
      const totalW = imgW + rightLayout.panelW;

      stageCanvas.width = totalW * pixelScale;
      stageCanvas.height = outH * pixelScale;
      stageCanvas.style.display = "block";
      scopeEmpty.style.display = "none";
      const ctx = stageCanvas.getContext("2d");
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      if (pixelScale > 1) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
      }

      activeEncoder = await FixedVideo.create(stageCanvas, fps, 6_000_000 * pixelScale * pixelScale);
      log(bi("開始固定時間軸編碼", "Encoding on a fixed timeline"));
      const n = exportEntries.length;
      const failedCount = imageEntries.length - n;

      for (let idx = 0; idx < n; idx++) {
        if (cancelRequested) break;
        const entry = exportEntries[idx];
        let img;
        try {
          img = idx === firstLoadable.idx ? firstImg : await loadImage(entry.file);
        } catch (err) {
          throw new Error(bi(`圖片讀取失敗，停止輸出以保留時間軸：${entry.file.name}`, `Image read failed; export stopped to preserve the timeline: ${entry.file.name}`));
        }

        cfg.currentShift = cfg.alignEnabled
          ? await getAlignmentShift(imageEntries.indexOf(entry), img, cfg)
          : {x:0, y:0, score:1, valid:true};
        if (cfg.alignEnabled && !cfg.currentShift.valid) {
          log(bi(`[警告] ${entry.file.name} 對齊可信度過低，保留原位置`, `[Warning] Alignment confidence was too low for ${entry.file.name}; original position retained`), "warn");
        }

        // draw original image or absolute difference from the baseline image
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, totalW, outH);
        paintImageMode(ctx, img, imgW, outH, cfg);
        drawCoverageMask(ctx,imgW,outH,entry.minute+cfg.imageOffsetMin);
        renderZoomRoi(ctx, img, imgW, outH, cfg, entry.minute+cfg.imageOffsetMin);

        // time label on image
        const currentTimeH = (entry.minute + cfg.imageOffsetMin) / 60;

        // 先找出對應這個時間點最接近的電壓值，一起標在圖片上
        let nearestIdx = 0,
          nearestDiff = Infinity;
        if (hasEchem) {
          for (let k = 0; k < adjustedT.length; k++) {
            const d = Math.abs(adjustedT[k] - currentTimeH);
            if (d < nearestDiff) {
              nearestDiff = d;
              nearestIdx = k;
            }
          }
        }
        const nearestV = hasEchem ? echemV[nearestIdx] : null;
        const nearestI = hasEchem && echemI ? echemI[nearestIdx] : null;

        const topLabels=[];
        if(cfg.showTime)topLabels.push({text:`t = ${(entry.minute + cfg.imageOffsetMin).toFixed(1)} min`,color:"#fff"});
        const mainCoverage=mainCoverageLabelAt(entry.minute+cfg.imageOffsetMin);
        if(mainCoverage)topLabels.push(mainCoverage);
        if(hasEchem)topLabels.push({text:`Ewe = ${nearestV.toFixed(3)} V`,color:"#FFB454"});
        if (showCurrent && nearestI !== null && Number.isFinite(nearestI)) {
          topLabels.push({text:`I = ${nearestI.toFixed(3)} mA`,color:"#57D9C4"});
        }
        if(cfg.annotation)topLabels.push({text:cfg.annotation,color:"#57D9C4"});
        drawMainLabels(ctx,topLabels,cfg,imgW,outH);

        // 曲線圖（含移動游標）委派給 EchemModule 繪製
        renderRightPanel(ctx,img,imgW,outH,cfg,rightLayout,hasEchem,showCurrent,currentTimeH);
        drawScaleBar(ctx, imgW, outH, cfg);

        // readout under preview（複用剛剛已經算好的 nearestIdx）
        readout.innerHTML =
          `<span>frame ${idx + 1}/${n}</span>` +
          `<span>t = <b>${(entry.minute + cfg.imageOffsetMin).toFixed(1)}</b> min</span>` +
          (hasEchem ? `<span>Ewe = <b>${echemV[nearestIdx].toFixed(3)}</b> V</span>` : "") +
          (hasEchem && echemI ? `<span>I = <b class="cy">${Number.isFinite(echemI[nearestIdx]) ? echemI[nearestIdx].toFixed(3) : "—"}</b> mA</span>` : "");

        const pct = Math.round(((idx + 1) / n) * 100);
        progFill.style.width = pct + "%";
        progText.textContent = t("progress", {current:idx + 1, total:n, pct});
        if ((idx + 1) % 10 === 0 || idx + 1 === n) log(t("progress", {current:idx + 1, total:n, pct}));

        await activeEncoder.addImage(idx, secondsPerImage, () => cancelRequested);
      }

      if (cancelRequested) {
        log(bi("影片產生已取消。", "Video generation canceled."), "warn");
        setStatus("ready", bi("已取消", "Canceled"));
        return;
      }

      const blob = await activeEncoder.finish(Math.round(n * secondsPerImage * 1e6));
      activeEncoder = null;
      const url = URL.createObjectURL(blob);
      const ext = "webm";
      downloadCounter++;
      const baseName=safeOutputName(outputBaseNameInput.value)||(hasEchem?"om_echem_video":"om_video");
      const filename = `${baseName}${cfg.visualMode === "difference" ? "_difference" : ""}_${downloadCounter}.${ext}`;
      const infoText = currentLanguage === "en" ? `#${downloadCounter} — ${n}/${imageEntries.length} images, ${fps} target fps, ${secondsPerImage.toFixed(2)} s/image, duration ${(n * secondsPerImage).toFixed(3)} s, ${(blob.size / 1024 / 1024).toFixed(1)} MB` : `#${downloadCounter} — ${n}/${imageEntries.length} 張，${fps} 目標 fps，每張 ${secondsPerImage.toFixed(2)} 秒，長度 ${(n * secondsPerImage).toFixed(3)} 秒，${(blob.size / 1024 / 1024).toFixed(1)} MB`;
      addDownloadEntry(url, filename, infoText);

      log(bi(`── 完成！輸出 .${ext}，共 ${n}/${imageEntries.length} 幀成功寫入，${fps} fps ──`, `── Complete! Exported .${ext}; ${n}/${imageEntries.length} images written at ${fps} fps ──`), "ok");
      if (failedCount > 0) {
        log(bi(`有 ${failedCount} 張圖片因無法解碼被跳過。`, `${failedCount} images were skipped because they could not be decoded.`), "warn");
      }
      if (ext === "webm") {
        log(bi("提示：瀏覽器只能錄製 WebM 格式；如需 .mp4，可用 VLC / ffmpeg 轉檔。", "Note: The browser records WebM. Use VLC or ffmpeg if you need MP4."), "warn");
      }
      }
      setStatus("ready", t("statusDone"));
    } catch (err) {
      console.error(err);
      log(`${currentLanguage === "en" ? "[Error]" : "[錯誤]"} ${err.message || err}`, "err");
      setStatus("err", t("statusError"));
    } finally {
      if (activeEncoder) activeEncoder.close();
      lockedControls.forEach(([el, disabled]) => { el.disabled = disabled; });
      generating = false;
      cancelBtn.disabled = true;
      resetBtn.disabled = false;
      checkReady();
    }
  });
})();
