/*!
 * om-video_v1.6.0.js
 * ------------------------------------------------------------------
 * OM 影片模組：負責顯微鏡圖片與影片合成的所有邏輯——
 *   - 圖片載入（含失敗自動跳過）
 *   - 檔名時間解析（結尾連續數字 = 第幾分鐘）
 *   - 畫面合成（圖片 + 文字標籤 + echem 曲線圖）
 *   - 與 EchemModule 整合（呼叫其 parse / drawChart）
 *   - MediaRecorder 錄影與下載清單管理
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

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const imgInput = $("imgInput");
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
  const cancelBtn = $("cancelBtn");

  // ---------- i18n ----------
  const I18N = {
    "zh-TW": {
      appTitle:"同步影片產生器", stepInput:"01 / 輸入", inputHeading:"圖片與電化學資料", imageLabel:"OM 圖片（選取資料夾內所有圖檔）", chooseImages:"📁 選擇圖片檔案…", echemLabel:"GCPL 電化學資料（選填）", chooseEchem:"📄 選擇 txt 檔…", filenameHint:'圖片檔名結尾的連續數字會被當作「第幾分鐘」，例如 <code>OM_frame_23.jpg</code> → 23 分鐘。', stepFields:"02 / 欄位", fieldsHeading:"電化學欄位（僅在上傳 ECHEM 時使用）", timeColumn:"時間欄名稱", voltageColumn:"電壓欄名稱", currentColumn:"電流欄名稱", timeUnit:"時間欄單位", hours:"小時 (h)", minutes:"分鐘 (min)", seconds:"秒 (s)", showCurrent:"同時顯示電流曲線", stepOutput:"03 / 輸出", outputHeading:"影片參數", height:"畫面高度 (px)", duration:"每張圖片顯示時間（秒）", generate:"產生影片", reset:"重設", notStarted:"尚未開始", previewEmpty:'選好檔案並按「產生影片」後，這裡會即時顯示合成畫面', changelog:"版本歷程 / Changelog", statusIdle:"待輸入", statusReadyBoth:"就緒（OM + ECHEM）", statusReadyImage:"就緒（純圖片）", statusBusy:"產生中…", statusDone:"完成", statusError:"發生錯誤", noUsableImages:"沒有找到可用的圖片（檔名結尾需要有數字）", imageSummary:"共 {count} 張，時間範圍 {min} ~ {max} 分鐘", skippedSummary:"（跳過 {count} 張抓不到數字的）", imageLoaded:"圖片載入：共 {count} 張，時間範圍 {min}~{max} 分鐘", skippedImages:"跳過 {count} 張檔名結尾抓不到數字的圖片", imageOnly:"未上傳，將使用純圖片模式", chooseImagesFirst:"[錯誤] 請先選擇圖片", start:"── 開始產生影片 ──", modeBoth:"模式：OM 圖片 + ECHEM 同步", modeImage:"模式：純 OM 圖片 time-lapse", progress:"進度: {current}/{total} ({pct}%)", download:"下載 {filename}", remove:"移除這個項目", noChangelog:"尚無版本紀錄", autoPlaceholder:"自動偵測", colError:"無法自動偵測時間/電壓欄位。欄位有：{headers}", parseIssues:"echem 解析出現 {count} 個小問題（通常可忽略）"
    },
    en: {
      appTitle:"Synchronized Video Generator", stepInput:"01 / INPUT", inputHeading:"Images and electrochemical data", imageLabel:"OM images (select all image files)", chooseImages:"📁 Choose image files…", echemLabel:"GCPL electrochemical data (optional)", chooseEchem:"📄 Choose TXT file…", filenameHint:'Trailing digits in each image filename are interpreted as minutes. Example: <code>OM_frame_23.jpg</code> → 23 min.', stepFields:"02 / COLUMNS", fieldsHeading:"Electrochemical columns (used only when ECHEM is uploaded)", timeColumn:"Time column", voltageColumn:"Voltage column", currentColumn:"Current column", timeUnit:"Time-column unit", hours:"Hours (h)", minutes:"Minutes (min)", seconds:"Seconds (s)", showCurrent:"Also show the current curve", stepOutput:"03 / OUTPUT", outputHeading:"Video settings", height:"Frame height (px)", duration:"Display time per image (seconds)", generate:"Generate video", reset:"Reset", notStarted:"Not started", previewEmpty:'Choose files and click “Generate video” to preview the composed frames here.', changelog:"Version history / Changelog", statusIdle:"Waiting for input", statusReadyBoth:"Ready (OM + ECHEM)", statusReadyImage:"Ready (images only)", statusBusy:"Generating…", statusDone:"Complete", statusError:"Error", noUsableImages:"No usable images found (filenames must end with digits)", imageSummary:"{count} images, time range {min}–{max} min", skippedSummary:" ({count} without trailing digits skipped)", imageLoaded:"Images loaded: {count}, time range {min}–{max} min", skippedImages:"Skipped {count} images whose filenames do not end with digits", imageOnly:"Not uploaded; image-only mode will be used", chooseImagesFirst:"[Error] Please select images first", start:"── Starting video generation ──", modeBoth:"Mode: synchronized OM images + ECHEM", modeImage:"Mode: OM image-only time-lapse", progress:"Progress: {current}/{total} ({pct}%)", download:"Download {filename}", remove:"Remove this item", noChangelog:"No version history", autoPlaceholder:"Auto-detect", colError:"Could not detect time/voltage columns. Available columns: {headers}", parseIssues:"ECHEM parsing reported {count} minor issues (usually safe to ignore)"
    }
  };
  Object.assign(I18N["zh-TW"], {stepCompose:"03 / 同步與畫面", stepOutput:"04 / 輸出", composeHeading:"同步、圖片與標註", imageOffset:"OM 時間偏移 (min)", echemOffset:"ECHEM 時間偏移 (min)", fitMode:"圖片顯示方式", fit:"Fit（完整顯示）", fill:"Fill（填滿裁切）", visualMode:"影像模式", originalMode:"原始影像", differenceMode:"相對第一張差分", differenceGain:"差異增益", showScaleBar:"另外疊加尺標", scaleLabel:"尺標文字", scaleLength:"尺標長度 (px)", scaleThickness:"尺標粗細 (px)", differenceHint:"差分顏色代表像素相對第一張發生變化；樣品位移、焦距、照明與曝光改變也會產生差分訊號。", sampleName:"Sample name／自訂標註", showTime:"顯示時間標籤", preview:"更新預覽", previewFrame:"預覽圖片", cancel:"取消產生"});
  Object.assign(I18N.en, {stepCompose:"03 / SYNC & FRAME", stepOutput:"04 / OUTPUT", composeHeading:"Synchronization, image, and annotation", imageOffset:"OM time offset (min)", echemOffset:"ECHEM time offset (min)", fitMode:"Image fit mode", fit:"Fit (show entire image)", fill:"Fill (crop to frame)", visualMode:"Image mode", originalMode:"Original image", differenceMode:"Difference from first image", differenceGain:"Difference gain", showScaleBar:"Overlay scale bar", scaleLabel:"Scale-bar label", scaleLength:"Scale-bar length (px)", scaleThickness:"Scale-bar thickness (px)", differenceHint:"Difference colors indicate pixel changes relative to the first image. Motion, focus, illumination, and exposure changes can also produce difference signals.", sampleName:"Sample name / custom annotation", showTime:"Show time label", preview:"Update preview", previewFrame:"Preview image", cancel:"Cancel generation"});
  let currentLanguage = localStorage.getItem("omEchemLanguage") || "zh-TW";
  if (!I18N[currentLanguage]) currentLanguage = "zh-TW";
  const t = (key, vars = {}) => (I18N[currentLanguage][key] || I18N["zh-TW"][key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const bi = (zh, en) => currentLanguage === "en" ? en : zh;
  function applyLanguage() {
    document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-Hant";
    document.title = `OM × ECHEM — ${t("appTitle")} v1.6.0`;
    $("appTitle").textContent = t("appTitle");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $("colTime").placeholder = currentLanguage === "en" ? "Auto-detect (e.g., time/h)" : "自動偵測 (例如 time/h)";
    $("colVolt").placeholder = currentLanguage === "en" ? "Auto-detect (Ewe/V)" : "自動偵測 (Ewe/V)";
    $("colCurr").placeholder = currentLanguage === "en" ? "Auto-detect (I/mA)" : "自動偵測 (I/mA)";
    versionBadge.title = currentLanguage === "en" ? "View version history" : "查看版本歷程";
    languageSelect.value = currentLanguage;
  }
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

  // ---------- filename minute parsing ----------
  function extractMinute(filename) {
    const stem = filename.replace(/\.[^.]+$/, "");
    const m = stem.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  imgInput.addEventListener("change", () => {
    const files = Array.from(imgInput.files || []);
    const tagged = [];
    let skipped = 0;
    for (const f of files) {
      const minute = extractMinute(f.name);
      if (minute === null) {
        skipped++;
        continue;
      }
      tagged.push({ minute, file: f });
    }
    tagged.sort((a, b) => a.minute - b.minute);
    imageEntries = tagged;
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
      const secondsPerImage = Math.max(0.1, parseFloat($("frameDuration").value) || 0.5);
      log(bi(`預估影片長度：約 ${(tagged.length * secondsPerImage).toFixed(1)} 秒`, `Estimated video length: ${(tagged.length * secondsPerImage).toFixed(1)} seconds`));
    }
    checkReady();
  });

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
    echemT = [];
    echemV = [];
    echemI = null;
    imgInput.value = "";
    echemInput.value = "";
    imgSummary.textContent = "";
    echemSummary.textContent = "";
    previewSlider.value = "0";
    previewSlider.max = "0";
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
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(bi(`瀏覽器無法解碼此圖片：${file.name}（可能不是標準 JPG/PNG/WebP）`, `The browser could not decode ${file.name}. It may not be a standard JPG/PNG/WebP file.`)));
      };
      img.src = url;
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
    return {
      outH: Math.max(240, parseInt($("outH").value, 10) || 480),
      fitMode: $("fitMode").value,
      imageOffsetMin,
      adjustedT: echemT.map((value) => value + echemOffsetMin / 60),
      annotation: $("sampleName").value.trim(),
      showTime: $("showTime").checked,
      visualMode: $("visualMode").value,
      differenceGain: Math.max(1, Math.min(20, parseFloat($("differenceGain").value) || 4)),
      showScaleBar: $("showScaleBar").checked,
      scaleLabel: $("scaleLabel").value.trim() || "100 µm",
      scaleLength: Math.max(10, parseInt($("scaleLength").value, 10) || 120),
      scaleThickness: Math.max(1, parseInt($("scaleThickness").value, 10) || 6),
      baselineImg: null
    };
  }

  function paintFitted(targetCtx, img, w, h, fitMode) {
    targetCtx.fillStyle = "#000"; targetCtx.fillRect(0, 0, w, h);
    const scale = fitMode === "contain" ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    targetCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function paintImageMode(ctx, img, imgW, outH, cfg) {
    if (cfg.visualMode !== "difference" || !cfg.baselineImg) {
      paintFitted(ctx, img, imgW, outH, cfg.fitMode);
      return;
    }
    const currentCanvas = document.createElement("canvas");
    const baselineCanvas = document.createElement("canvas");
    currentCanvas.width = baselineCanvas.width = imgW;
    currentCanvas.height = baselineCanvas.height = outH;
    const currentCtx = currentCanvas.getContext("2d", {willReadFrequently:true});
    const baselineCtx = baselineCanvas.getContext("2d", {willReadFrequently:true});
    paintFitted(currentCtx, img, imgW, outH, cfg.fitMode);
    paintFitted(baselineCtx, cfg.baselineImg, imgW, outH, cfg.fitMode);
    const current = currentCtx.getImageData(0, 0, imgW, outH);
    const baseline = baselineCtx.getImageData(0, 0, imgW, outH);
    for (let p = 0; p < current.data.length; p += 4) {
      current.data[p] = Math.min(255, Math.abs(current.data[p] - baseline.data[p]) * cfg.differenceGain);
      current.data[p + 1] = Math.min(255, Math.abs(current.data[p + 1] - baseline.data[p + 1]) * cfg.differenceGain);
      current.data[p + 2] = Math.min(255, Math.abs(current.data[p + 2] - baseline.data[p + 2]) * cfg.differenceGain);
      current.data[p + 3] = 255;
    }
    ctx.putImageData(current, 0, 0);
  }

  function drawScaleBar(ctx, imgW, outH, cfg) {
    if (!cfg.showScaleBar) return;
    const margin = 24;
    const length = Math.min(cfg.scaleLength, Math.max(10, imgW - margin * 2));
    const x2 = imgW - margin, x1 = x2 - length;
    const y = outH - 28;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = cfg.scaleThickness + 4;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = cfg.scaleThickness;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.font = "600 17px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center"; ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.fillStyle = "#fff";
    ctx.strokeText(cfg.scaleLabel, (x1 + x2) / 2, y - 12);
    ctx.fillText(cfg.scaleLabel, (x1 + x2) / 2, y - 12);
    ctx.restore();
  }

  function drawComposedFrame(ctx, img, entry, cfg) {
    const hasEchem = cfg.adjustedT.length > 0 && echemV.length > 0;
    const imgAspect = img.width / img.height;
    const imgW = Math.round(cfg.outH * imgAspect);
    const plotW = hasEchem ? Math.round(cfg.outH * 1.3) : 0;
    const totalW = imgW + plotW;
    if (stageCanvas.width !== totalW || stageCanvas.height !== cfg.outH) {
      stageCanvas.width = totalW; stageCanvas.height = cfg.outH;
    }
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, totalW, cfg.outH);
    paintImageMode(ctx, img, imgW, cfg.outH, cfg);
    const currentTimeH = (entry.minute + cfg.imageOffsetMin) / 60;
    let nearestIdx = 0, nearestDiff = Infinity;
    if (hasEchem) cfg.adjustedT.forEach((value, idx) => { const d = Math.abs(value - currentTimeH); if (d < nearestDiff) { nearestDiff = d; nearestIdx = idx; } });
    ctx.font = "600 18px 'IBM Plex Mono', monospace"; ctx.lineWidth = 4; ctx.textAlign = "left";
    const labels = [];
    if (cfg.showTime) labels.push({text:`t = ${(entry.minute + cfg.imageOffsetMin).toFixed(1)} min`, color:"#fff"});
    if (hasEchem) labels.push({text:`Ewe = ${echemV[nearestIdx].toFixed(3)} V`, color:"#FFB454"});
    if (cfg.annotation) labels.push({text:cfg.annotation, color:"#57D9C4"});
    if (cfg.visualMode === "difference") labels.push({text:`|image − first| × ${cfg.differenceGain}`, color:"#FF6B6B"});
    labels.forEach((label, idx) => { const y = 30 + idx * 24; ctx.strokeStyle="rgba(0,0,0,.85)"; ctx.fillStyle=label.color; ctx.strokeText(label.text,16,y); ctx.fillText(label.text,16,y); });
    const showCurrent = hasEchem && $("showCurrent").checked && !!echemI;
    if (hasEchem) Echem.drawChart(ctx, imgW, 0, plotW, cfg.outH, cfg.adjustedT, echemV, echemI, showCurrent, currentTimeH);
    drawScaleBar(ctx, imgW, cfg.outH, cfg);
    readout.innerHTML = `<span>frame ${Number(previewSlider.value) + 1}/${imageEntries.length}</span><span>t = <b>${(entry.minute + cfg.imageOffsetMin).toFixed(1)}</b> min</span>` + (hasEchem ? `<span>Ewe = <b>${echemV[nearestIdx].toFixed(3)}</b> V</span>` : "");
    return {totalW, currentTimeH, nearestIdx};
  }

  async function updatePreview() {
    if (!imageEntries.length || generating) return;
    const idx = Math.min(imageEntries.length - 1, Math.max(0, parseInt(previewSlider.value, 10) || 0));
    try {
      const img = await loadImage(imageEntries[idx].file);
      const cfg = frameSettings();
      if (cfg.visualMode === "difference") cfg.baselineImg = idx === 0 ? img : await loadImage(imageEntries[0].file);
      stageCanvas.style.display = "block"; scopeEmpty.style.display = "none";
      drawComposedFrame(stageCanvas.getContext("2d"), img, imageEntries[idx], cfg);
    } catch (err) { log(`${currentLanguage === "en" ? "[Error]" : "[錯誤]"} ${err.message}`, "err"); }
  }
  previewBtn.addEventListener("click", updatePreview);
  previewSlider.addEventListener("input", updatePreview);
  ["imageOffset","echemOffset","fitMode","visualMode","differenceGain","showScaleBar","scaleLabel","scaleLength","scaleThickness","sampleName","showTime","outH","showCurrent"].forEach((id) => $(id).addEventListener("change", updatePreview));
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

    try {
      const fps = Math.max(1, parseInt($("fps").value, 10) || 8);
      const outH = Math.max(240, parseInt($("outH").value, 10) || 480);
      const secondsPerImage = Math.max(0.1, parseFloat($("frameDuration").value) || 0.5);
      const cfg = frameSettings();
      const adjustedT = cfg.adjustedT;
      const hasEchem = echemT.length > 0 && echemV.length > 0;
      const showCurrent = hasEchem && $("showCurrent").checked && !!echemI;
      if (hasEchem && $("showCurrent").checked && !echemI) {
        log(bi("[警告] 找不到電流欄位，將只顯示電壓曲線", "[Warning] No current column was found; only the voltage curve will be shown."), "warn");
      }
      log(hasEchem ? t("modeBoth") : t("modeImage"), "ok");

      // 依序嘗試找出第一張「瀏覽器讀得懂」的圖片，用來決定畫面尺寸
      const firstLoadable = await findFirstLoadable(imageEntries);
      if (!firstLoadable) {
        throw new Error(bi("所有圖片都無法被瀏覽器解碼。請改用標準 JPG/PNG/WebP，或使用支援顯微鏡格式的桌面工具。", "None of the images could be decoded. Use standard JPG/PNG/WebP files or a desktop tool that supports microscopy formats."));
      }
      const firstImg = firstLoadable.img;
      cfg.baselineImg = firstImg;
      const imgAspect = firstImg.width / firstImg.height;
      const imgW = Math.round(outH * imgAspect);
      const plotW = hasEchem ? Math.round(outH * 1.3) : 0;
      const totalW = imgW + plotW;

      stageCanvas.width = totalW;
      stageCanvas.height = outH;
      stageCanvas.style.display = "block";
      scopeEmpty.style.display = "none";
      const ctx = stageCanvas.getContext("2d");

      // set up recorder
      const stream = stageCanvas.captureStream(fps);
      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };

      const recordingDone = new Promise((resolve) => {
        recorder.onstop = () => resolve();
      });

      recorder.start();
      log(bi(`錄影開始（${mimeType}，${fps} fps，畫面 ${totalW}×${outH}）`, `Recording started (${mimeType}, ${fps} fps, ${totalW}×${outH})`));

      const n = imageEntries.length;
      const frameIntervalMs = secondsPerImage * 1000;
      let failedCount = 0;

      for (let idx = 0; idx < n; idx++) {
        if (cancelRequested) break;
        const t0 = performance.now();
        const entry = imageEntries[idx];
        let img;
        try {
          img = idx === firstLoadable.idx ? firstImg : await loadImage(entry.file);
        } catch (err) {
          log(bi(`[警告] ${err.message}，跳過`, `[Warning] ${err.message} Skipped.`), "warn");
          failedCount++;
          continue;
        }

        // draw original image or absolute difference from the baseline image
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, totalW, outH);
        paintImageMode(ctx, img, imgW, outH, cfg);

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

        const timeLabel = `t = ${(entry.minute + cfg.imageOffsetMin).toFixed(1)} min`;
        const voltLabel = hasEchem ? `Ewe = ${nearestV.toFixed(3)} V` : "";
        ctx.font = "600 18px 'IBM Plex Mono', monospace";
        ctx.lineWidth = 4;
        ctx.textAlign = "left";

        if (cfg.showTime) {
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.fillStyle = "#fff";
          ctx.strokeText(timeLabel, 16, 30);
          ctx.fillText(timeLabel, 16, 30);
        }

        if (hasEchem) {
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.fillStyle = "#FFB454";
          ctx.strokeText(voltLabel, 16, 54);
          ctx.fillText(voltLabel, 16, 54);
        }

        if (showCurrent && nearestI !== null && Number.isFinite(nearestI)) {
          const currLabel = `I = ${nearestI.toFixed(3)} mA`;
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.fillStyle = "#57D9C4";
          ctx.strokeText(currLabel, 16, 78);
          ctx.fillText(currLabel, 16, 78);
        }
        if (cfg.annotation) {
          ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.fillStyle = "#57D9C4";
          ctx.strokeText(cfg.annotation, 16, cfg.showTime ? 102 : 30); ctx.fillText(cfg.annotation, 16, cfg.showTime ? 102 : 30);
        }
        if (cfg.visualMode === "difference") {
          const diffLabel = `|image − first| × ${cfg.differenceGain}`;
          ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.fillStyle = "#FF6B6B";
          ctx.strokeText(diffLabel, 16, outH - 18); ctx.fillText(diffLabel, 16, outH - 18);
        }

        // 曲線圖（含移動游標）委派給 EchemModule 繪製
        if (hasEchem) {
          Echem.drawChart(ctx, imgW, 0, plotW, outH, adjustedT, echemV, echemI, showCurrent, currentTimeH);
        }
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

        // wait remaining frame time so captureStream records a real frame at this cadence
        const elapsed = performance.now() - t0;
        const wait = Math.max(0, frameIntervalMs - elapsed);
        await new Promise((r) => setTimeout(r, wait));
      }

      // hold last frame briefly then stop
      await new Promise((r) => setTimeout(r, Math.max(200, frameIntervalMs)));
      recorder.stop();
      await recordingDone;

      if (cancelRequested) {
        log(bi("影片產生已取消。", "Video generation canceled."), "warn");
        setStatus("ready", bi("已取消", "Canceled"));
        return;
      }

      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      const url = URL.createObjectURL(blob);
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      downloadCounter++;
      const filename = `${hasEchem ? "om_echem_video" : "om_video"}${cfg.visualMode === "difference" ? "_difference" : ""}_${downloadCounter}.${ext}`;
      const infoText = currentLanguage === "en" ? `#${downloadCounter} — ${n - failedCount}/${n} images, ${fps} fps, ${secondsPerImage.toFixed(1)} s/image, approx. ${((n - failedCount) * secondsPerImage).toFixed(1)} s, ${(blob.size / 1024 / 1024).toFixed(1)} MB` : `#${downloadCounter} — ${n - failedCount}/${n} 張，${fps} fps，每張 ${secondsPerImage.toFixed(1)} 秒，約 ${((n - failedCount) * secondsPerImage).toFixed(1)} 秒，${(blob.size / 1024 / 1024).toFixed(1)} MB`;
      addDownloadEntry(url, filename, infoText);

      log(bi(`── 完成！輸出 .${ext}，共 ${n - failedCount}/${n} 幀成功寫入，${fps} fps ──`, `── Complete! Exported .${ext}; ${n - failedCount}/${n} images written at ${fps} fps ──`), "ok");
      if (failedCount > 0) {
        log(bi(`有 ${failedCount} 張圖片因無法解碼被跳過。`, `${failedCount} images were skipped because they could not be decoded.`), "warn");
      }
      if (ext === "webm") {
        log(bi("提示：瀏覽器只能錄製 WebM 格式；如需 .mp4，可用 VLC / ffmpeg 轉檔。", "Note: The browser records WebM. Use VLC or ffmpeg if you need MP4."), "warn");
      }
      setStatus("ready", t("statusDone"));
    } catch (err) {
      console.error(err);
      log(`${currentLanguage === "en" ? "[Error]" : "[錯誤]"} ${err.message || err}`, "err");
      setStatus("err", t("statusError"));
    } finally {
      generating = false;
      cancelBtn.disabled = true;
      resetBtn.disabled = false;
      checkReady();
    }
  });
})();
