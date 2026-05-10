/**
 * Wall-clock frame duration sampling for Anu / adaptive policy (main thread).
 */

const _ROLL_LEN = 45;
const _samples = [];

let _lastMs = 0;

export function recordFrameDuration(ms) {
  _lastMs = ms;
  _samples.push(ms);
  if (_samples.length > _ROLL_LEN) _samples.shift();
}

export function getLastFrameMs() {
  return _lastMs;
}

export function getRollingAvgFrameMs() {
  if (_samples.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < _samples.length; i++) s += _samples[i];
  return s / _samples.length;
}

export function getFrameBudgetSnapshot() {
  return Object.freeze({
    lastMs: _lastMs,
    avgMs: getRollingAvgFrameMs(),
    samples: _samples.length,
  });
}
