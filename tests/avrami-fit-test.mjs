import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../om-video_v1.28.0.js', import.meta.url), 'utf8');
const start = source.indexOf('  function fitAvramiCoverage(');
const end = source.indexOf('  function clearAvramiEquation()', start);
assert.ok(start >= 0 && end > start, 'Avrami fitter must be present');
const fit = vm.runInNewContext(`${source.slice(start, end)};fitAvramiCoverage`);
const rows = Array.from({ length: 976 }, (_, time) => ({
  time,
  values: [1 + 92 * (1 - Math.exp(-Math.pow(Math.max(0, time - 39) / 70, 0.625)))],
}));
const result = fit(rows, 800);
assert.ok(result, 'must fit synthetic coverage');
assert.equal(result.endTime, 800, 'fit must stop at requested time');
assert.ok(Math.abs(result.n - 0.625) < 0.06, 'exponent should match source');
assert.ok(result.rmse < 0.2, 'fit should explain synthetic data');
assert.equal(fit(rows, -1), null, 'empty fit range must not produce a result');
const equationStart = source.indexOf('  function formatAvramiEquation(');
const equationEnd = source.indexOf('  copyAvramiEquationBtn.addEventListener', equationStart);
const format = vm.runInNewContext(`${source.slice(equationStart,equationEnd)};formatAvramiEquation`);
const text = format(result);
for (const parameter of [result.baseline,result.amplitude,result.lag,result.tau,result.n]) {
  assert.ok(text.includes(Number(parameter.toPrecision(8)).toString()), 'equation must show the fitted parameters');
}
assert.ok(text.includes('t ≤ 800 min') && text.includes('RMSE'), 'equation must identify its fitting range and error');
console.log('Avrami fit passed: exponent, RMSE, cutoff and empty range.');
