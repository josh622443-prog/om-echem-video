import assert from 'node:assert/strict';
import '../fixed-video_v1.28.0.js';

// Image boundaries, nominal frame ticks, and final duration must remain exact,
// including sub-frame image durations and values not divisible by the FPS.
for (const [count, seconds, fps] of [[1000,.01,120], [12,.13,30],
  [12,.01,8], [17,.5,8], [100,.03,30], [3,60,1]]) {
  let end = 0, frames = 0;
  for (let i = 0; i < count; i++) {
    const image = [...FixedVideo.imageFrames(i, seconds, fps)];
    assert.ok(image.length > 0, 'every image must appear');
    assert.equal(image[0].timestamp, Math.round(i * seconds * 1e6));
    for (const f of image) {
      assert.equal(f.timestamp, end, 'no gap or overlap');
      assert.ok(f.duration > 0);
      end += f.duration; frames++;
    }
    assert.equal(end, Math.round((i + 1) * seconds * 1e6));
  }
  assert.equal(end, Math.round(count * seconds * 1e6));
  assert.ok(frames >= count);
}
console.log('Timeline tests passed: contiguous frames, every image retained, exact duration.');
