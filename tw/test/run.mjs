// Runs every test in this folder:   node test/run.mjs
// Add a name to run only matching tests:   node test/run.mjs near
//
// Each test runs in its own Node process, because each one fakes a different
// slice of the browser (document, Worker, WebGL) on the global object, and
// those fakes must not leak into each other.

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2] || '';
const files = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && f.includes(only))
  .sort();

const TIMEOUT_MS = 120000;

function runOne(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(here, file)], { cwd: dirname(here) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\n(timed out)'; child.kill(); }, TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0, out, ms: Date.now() - t0 });
    });
  });
}

const results = [];
for (const f of files) {
  const r = await runOne(f);
  results.push(r);
  console.log(`${r.ok ? 'pass' : 'FAIL'}  ${f.padEnd(22)} ${(r.ms / 1000).toFixed(1)} s`);
}

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n---- ${r.file} ----\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
}
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
