/*!
 * echem_v1.6.0.js
 * ------------------------------------------------------------------
 * ECHEM 模組：負責電化學 GCPL txt/csv 資料的所有邏輯——
 *   - 欄位自動偵測（時間 / 電壓 / 電流），支援使用者手動覆寫欄名
 *   - 時間單位換算（小時 / 分鐘 / 秒 → 統一內部以「小時」表示）
 *   - 電壓／電流曲線繪製（含移動中的紅色游標，畫在傳入的 canvas context 上）
 *
 * 本檔案不接觸任何 DOM，也不知道「圖片」或「影片」的存在，
 * 只單純處理 echem 資料與繪圖，方便獨立維護、測試或替換。
 *
 * 相依：PapaParse（需先在頁面中載入 papaparse，透過全域 window.Papa 取用）
 *
 * 對外介面：window.EchemModule
 *   - findCol(headers, userVal, keywords) -> string|null
 *   - parse(text, opts) -> { ok, t, v, iArr, colsDetected, headers, parseErrorCount, error }
 *   - drawChart(ctx, x0, y0, w, h, t, v, iArr, showCurrent, currentTimeH)
 *   - unitLabel(unit) -> string（"小時" / "分鐘" / "秒"，用於訊息顯示）
 *   - checkRangeMismatch(tMinH, tMaxH, imgMinH, imgMaxH) -> boolean
 * ------------------------------------------------------------------
 */
window.EchemModule = (function () {
  "use strict";

  // ---------- 欄位自動偵測 ----------
  // 若使用者有手動指定欄名（userVal 非空），優先使用完全比對；
  // 否則依關鍵字（小寫比對、包含即可）在標頭清單中尋找第一個符合的欄位。
  function findCol(headers, userVal, keywords) {
    if (userVal && userVal.trim()) {
      const hit = headers.find((h) => h === userVal.trim());
      return hit || null;
    }
    const lower = headers.map((h) => [h, h.toLowerCase()]);
    for (const [orig, low] of lower) {
      if (keywords.some((k) => low.includes(k))) return orig;
    }
    return null;
  }

  // ---------- 時間單位換算 ----------
  function toHours(value, unit) {
    if (unit === "s") return value / 3600;
    if (unit === "min") return value / 60;
    return value; // "h"
  }

  function unitLabel(unit) {
    return unit === "h" ? "小時" : unit === "min" ? "分鐘" : "秒";
  }

  function toFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value !== "string") return NaN;
    const normalized = value.trim().replace(/\u2212/g, "-").replace(/([0-9])D([+-]?[0-9]+)/i, "$1E$2");
    if (!normalized) return NaN;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : NaN;
  }

  // Supports instrument timestamps such as 09/11/2026 22:00:42.3394.
  // UTC is used so elapsed time is unaffected by browser timezone or daylight saving.
  function parseTimestampMs(value) {
    if (typeof value !== "string") return NaN;
    const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (!match) return NaN;
    const [, month, day, year, hour, minute, second, fraction = ""] = match;
    const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0;
    return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, 0) + fractionMs;
  }

  // ---------- 解析 echem 文字內容 ----------
  // opts: { colTime, colVolt, colCurr, timeUnit }（皆為使用者輸入框的原始字串/值）
  // 回傳統一格式的結果物件，不做任何 DOM / log 輸出，交由呼叫端處理顯示。
  function parse(text, opts) {
    opts = opts || {};
    const parsed = Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimitersToGuess: [",", "\t", ";", " "],
    });

    const parseErrorCount = (parsed.errors && parsed.errors.length) || 0;
    const headers = parsed.meta.fields || [];

    const timeCol = findCol(headers, opts.colTime, ["time"]);
    const voltCol = findCol(headers, opts.colVolt, ["ewe", "voltage", "v)"]);
    const currCol = findCol(headers, opts.colCurr, ["i/ma", "current", "i (ma)", "i/a"]);

    if (!timeCol || !voltCol) {
      return {
        ok: false,
        error: "無法自動偵測時間或電壓欄位。",
        headers,
        colsDetected: null,
        t: [],
        v: [],
        iArr: null,
        parseErrorCount,
      };
    }

    const unit = opts.timeUnit || "h";
    const t = [],
      v = [],
      iArr = currCol ? [] : null;
    let firstTimestampMs = null;
    let timeMode = "numeric";

    for (const row of parsed.data) {
      const tv = row[timeCol],
        vv = row[voltCol],
        iv = currCol ? row[currCol] : null;
      const voltage = toFiniteNumber(vv);
      if (!Number.isFinite(voltage)) continue;
      const numericTime = toFiniteNumber(tv);
      let timeH;
      if (Number.isFinite(numericTime)) {
        timeH = toHours(numericTime, unit);
      } else {
        const timestampMs = parseTimestampMs(tv);
        if (!Number.isFinite(timestampMs)) continue;
        if (firstTimestampMs === null) firstTimestampMs = timestampMs;
        timeH = (timestampMs - firstTimestampMs) / 3_600_000;
        timeMode = "datetime";
      }
      t.push(timeH);
      v.push(voltage);
      if (iArr) iArr.push(toFiniteNumber(iv));
    }

    return {
      ok: true,
      t,
      v,
      iArr,
      colsDetected: { timeCol, voltCol, currCol },
      headers,
      timeMode,
      parseErrorCount,
    };
  }

  // ---------- 時間範圍合理性檢查（用於提醒單位可能選錯） ----------
  // 回傳 true 代表 echem 時間範圍跟圖片時間範圍差異過大，很可能是單位選錯了。
  function checkRangeMismatch(tMinH, tMaxH, imgMinH, imgMaxH) {
    return tMaxH < imgMaxH * 0.3 || tMaxH > imgMaxH * 30;
  }

  // ---------- 曲線圖繪製（電壓／電流，含移動紅色游標） ----------
  // 深色示波器風格：琥珀色電壓、青色電流。直接畫在呼叫端提供的 canvas context 上，
  // 座標系以 (x0, y0) 為左上角、寬 w、高 h 的區塊。
  function drawChart(ctx, x0, y0, w, h, t, v, iArr, showCurrent, currentTimeH) {
    ctx.save();
    ctx.translate(x0, y0);

    // background
    ctx.fillStyle = "#12161A";
    ctx.fillRect(0, 0, w, h);

    const padL = 54,
      padR = showCurrent ? 54 : 16,
      padT = 26,
      padB = 34;
    const plotW = w - padL - padR,
      plotH = h - padT - padB;

    const tMin = Math.min(...t),
      tMax = Math.max(...t);
    const vMin = Math.min(...v),
      vMax = Math.max(...v);
    const vPad = (vMax - vMin) * 0.08 || 0.1;
    const vLo = vMin - vPad,
      vHi = vMax + vPad;

    function xPix(tv) {
      return padL + ((tv - tMin) / (tMax - tMin || 1)) * plotW;
    }
    function yPixV(vv) {
      return padT + plotH - ((vv - vLo) / (vHi - vLo || 1)) * plotH;
    }

    // grid
    ctx.strokeStyle = "#22282E";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
      ctx.stroke();
    }

    // voltage line
    ctx.strokeStyle = "#FFB454";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let idx = 0; idx < t.length; idx++) {
      const px = xPix(t[idx]),
        py = yPixV(v[idx]);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // current line (secondary axis)
    let iLo = 0,
      iHi = 1;
    if (showCurrent && iArr) {
      const finiteI = iArr.filter((x) => Number.isFinite(x));
      iLo = Math.min(...finiteI);
      iHi = Math.max(...finiteI);
      const iPad = (iHi - iLo) * 0.15 || 0.05;
      iLo -= iPad;
      iHi += iPad;
      const yPixI = (iv) => padT + plotH - ((iv - iLo) / (iHi - iLo || 1)) * plotH;
      ctx.strokeStyle = "#57D9C4AA";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let idx = 0; idx < t.length; idx++) {
        if (!Number.isFinite(iArr[idx])) continue;
        const px = xPix(t[idx]),
          py = yPixI(iArr[idx]);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // current-time marker
    const mx = xPix(currentTimeH);
    ctx.strokeStyle = "#FF6B6B";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // nearest point dot
    let bestIdx = 0,
      bestDiff = Infinity;
    for (let idx = 0; idx < t.length; idx++) {
      const d = Math.abs(t[idx] - currentTimeH);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = idx;
      }
    }
    ctx.fillStyle = "#FF6B6B";
    ctx.beginPath();
    ctx.arc(xPix(t[bestIdx]), yPixV(v[bestIdx]), 4, 0, Math.PI * 2);
    ctx.fill();

    // axes labels
    ctx.fillStyle = "#8A94A0";
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("time / h", padL + plotW / 2, h - 10);

    ctx.save();
    ctx.translate(16, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#FFB454";
    ctx.textAlign = "center";
    ctx.fillText("Ewe / V", 0, 0);
    ctx.restore();

    if (showCurrent) {
      ctx.save();
      ctx.translate(w - 14, padT + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "#57D9C4";
      ctx.textAlign = "center";
      ctx.fillText("I / mA", 0, 0);
      ctx.restore();
    }

    // y tick numbers (voltage)
    ctx.fillStyle = "#8A94A0";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    for (let g = 0; g <= 4; g++) {
      const val = vHi - ((vHi - vLo) * g) / 4;
      const gy = padT + (plotH * g) / 4;
      ctx.fillText(val.toFixed(2), padL - 6, gy + 3);
    }

    // title
    ctx.fillStyle = "#E8ECEF";
    ctx.font = "600 12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`t = ${currentTimeH.toFixed(3)} h`, padL, 16);

    ctx.restore();
  }

  return {
    findCol,
    parse,
    drawChart,
    unitLabel,
    checkRangeMismatch,
  };
})();
