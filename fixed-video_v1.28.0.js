/* OM × ECHEM v1.28.0 — deterministic local WebCodecs/WebM export.
 * Video only; VP9/VP8. No real-time capture, network calls, or external dependency.
 * See LICENSE for the project's noncommercial terms.
 */
(() => {
  "use strict";
  const bytes = (n) => {
    let v = BigInt(n), out = [];
    do { out.unshift(Number(v & 255n)); v >>= 8n; } while (v);
    return new Uint8Array(out);
  };
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
  };
  const size = (n) => {
    let width = 1;
    while (BigInt(n) >= (1n << BigInt(7 * width)) - 1n) width++;
    let v = BigInt(n) | (1n << BigInt(7 * width));
    const out = new Uint8Array(width);
    for (let i = width - 1; i >= 0; i--) { out[i] = Number(v & 255n); v >>= 8n; }
    return out;
  };
  const el = (id, data) => join([bytes(id), size(data.length), data]);
  const uint = (id, n) => el(id, bytes(n));
  const str = (id, s) => el(id, new TextEncoder().encode(s));
  const master = (id, parts) => el(id, join(parts));
  const float = (id, n) => {
    const data = new Uint8Array(8); new DataView(data.buffer).setFloat64(0, n);
    return el(id, data);
  };

  // Regular FPS ticks plus exact image boundaries. Boundary frames preserve every
  // image even when display time is shorter than one nominal FPS interval.
  function* imageFrames(index, seconds, fps) {
    const start = Math.round(index * seconds * 1e6);
    const end = Math.round((index + 1) * seconds * 1e6);
    let t = start;
    let tick = Math.floor(start * fps / 1e6) + 1;
    while (t < end) {
      let next = Math.round(tick * 1e6 / fps);
      tick++;
      if (next <= t) continue;
      next = Math.min(next, end);
      yield { timestamp: t, duration: next - t };
      t = next;
    }
  }

  function mux(chunks, width, height, codec, durationUs) {
    const header = master(0x1a45dfa3, [uint(0x4286, 1), uint(0x42f7, 1),
      uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2)]);
    const info = master(0x1549a966, [uint(0x2ad7b1, 1000000),
      str(0x4d80, "OM ECHEM 1.28.0"), str(0x5741, "OM ECHEM 1.28.0"), float(0x4489, durationUs / 1000)]);
    const tracks = master(0x1654ae6b, [master(0xae, [uint(0xd7, 1), uint(0x73c5, 1),
      uint(0x83, 1), uint(0x9c, 0), str(0x86, codec === "vp8" ? "V_VP8" : "V_VP9"),
      master(0xe0, [uint(0xb0, width), uint(0xba, height)])])]);
    const clusters = [], cues = [];
    let clusterTime = 0, blocks = [], position = info.length + tracks.length, previousTime = 0;
    const finish = () => {
      if (!blocks.length) return;
      const cluster = master(0x1f43b675, [uint(0xe7, clusterTime), ...blocks]);
      cues.push(master(0xbb, [uint(0xb3, clusterTime), master(0xb7, [uint(0xf7, 1), uint(0xf1, position)])]));
      clusters.push(cluster); position += cluster.length; blocks = [];
    };
    for (const c of chunks) {
      const time = Math.round(c.timestamp / 1000);
      if (c.key && blocks.length) finish();
      if (!blocks.length) clusterTime = time;
      const relative = time - clusterTime;
      if (relative > 32767) throw new Error("WebM keyframe interval exceeded");
      const prefix = new Uint8Array([0x81, (relative >> 8) & 255, relative & 255, 0]);
      const duration = Math.round((c.timestamp + c.duration) / 1000) - time;
      const parts = [el(0xa1, join([prefix, c.data])), uint(0x9b, duration)];
      if (!c.key) {
        const ref = new Uint8Array(4); new DataView(ref.buffer).setInt32(0, previousTime - time);
        parts.push(el(0xfb, ref));
      }
      blocks.push(master(0xa0, parts)); previousTime = time;
    }
    finish();
    const cueData = master(0x1c53bb6b, cues);
    const segmentSize = position + cueData.length;
    // Blob parts avoid copying the whole encoded movie into another large buffer.
    return new Blob([header, bytes(0x18538067), size(segmentSize), info, tracks, ...clusters, cueData], {type:"video/webm"});
  }

  async function create(canvas, fps, bitrate) {
    if (!globalThis.VideoEncoder || !globalThis.VideoFrame) {
      throw new Error("固定時間軸輸出需要新版 Chrome／Edge（WebCodecs）。 / Fixed-timeline export requires current Chrome or Edge with WebCodecs.");
    }
    let config;
    for (const codec of ["vp09.00.10.08", "vp8"]) {
      const candidate = {codec, width:canvas.width, height:canvas.height, bitrate,
        framerate:fps, latencyMode:"quality", hardwareAcceleration:"prefer-software"};
      if ((await VideoEncoder.isConfigSupported(candidate)).supported) { config = candidate; break; }
    }
    if (!config) throw new Error("瀏覽器不支援 VP9／VP8 編碼。 / VP9/VP8 encoding is unavailable.");
    const chunks = [], durations = new Map();
    let failure, lastKey = -Infinity, closed = false;
    const encoder = new VideoEncoder({
      output(chunk) {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        chunks.push({data, timestamp:chunk.timestamp, duration:durations.get(chunk.timestamp), key:chunk.type === "key"});
        durations.delete(chunk.timestamp);
      },
      error(err) { failure = err; }
    });
    encoder.configure(config);
    const close = () => {
      if (encoder.state !== "closed") encoder.close();
      closed = true; durations.clear(); chunks.length = 0;
    };
    return {
      close,
      async addImage(index, seconds, cancelled = () => false) {
        if (closed) throw new Error("Encoder is closed");
        for (const timing of imageFrames(index, seconds, fps)) {
          if (cancelled()) return;
          if (failure) throw failure;
          const frame = new VideoFrame(canvas, timing);
          const keyFrame = timing.timestamp - lastKey >= 2000000;
          if (keyFrame) lastKey = timing.timestamp;
          durations.set(timing.timestamp, timing.duration);
          try { encoder.encode(frame, {keyFrame}); } finally { frame.close(); }
          if (encoder.encodeQueueSize >= 8) await encoder.flush();
        }
        // Yield for cancellation/UI only. This wait never enters video timestamps.
        await new Promise(resolve => setTimeout(resolve, 0));
        if (failure) throw failure;
      },
      async finish(durationUs) {
        try {
          await encoder.flush();
          if (failure) throw failure;
          if (!chunks.length) throw new Error("No video frames were encoded");
          chunks.sort((a,b) => a.timestamp - b.timestamp);
          return mux(chunks, canvas.width, canvas.height, config.codec, durationUs);
        } finally { close(); }
      }
    };
  }
  globalThis.FixedVideo = {create, imageFrames};
})();
