// Boot the dev server, open the page, screenshot after sim makes progress.
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5179;
const URL = `http://localhost:${PORT}/`;
const OUT = process.argv[2] ?? 'docs/phase-2-frame.png';

console.log('starting vite...');
const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ready = false;
dev.stdout.on('data', (buf) => {
  const s = buf.toString();
  if (s.includes('Local:')) {
    ready = true;
  }
});
dev.stderr.on('data', (buf) => process.stderr.write('vite stderr: ' + buf.toString()));

// Wait for vite ready (with timeout).
for (let i = 0; i < 60 && !ready; i++) {
  await wait(500);
}
if (!ready) {
  console.error('vite never reported ready');
  dev.kill();
  process.exit(1);
}
console.log('vite ready, waiting briefly then loading page');
await wait(800);

console.log('launching chromium...');
const CHROMIUM_PATH = '/home/gregtom3/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });

page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (msg) => {
  console.log(`page ${msg.type()}: ${msg.text()}`);
});

console.log(`navigating to ${URL}`);
const goUrl = process.argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ?? URL;
await page.goto(goUrl, { waitUntil: 'load', timeout: 20000 });
console.log('navigation complete; waiting 5s for sim to play out');
await wait(5000);

const outBase = OUT.endsWith('.png') ? OUT.slice(0, -4) : OUT;
const seqMode = process.argv.includes('--sequence');
const burstMode = process.argv.includes('--burst');
const captures = burstMode
  ? Array.from({ length: 40 }, (_, i) => ({ delay: i === 0 ? 0 : 400, suffix: `-b${String(i).padStart(2, '0')}` }))
  : seqMode
  ? [
      { delay: 0, suffix: '-01-early' },
      { delay: 6000, suffix: '-02-mid' },
      { delay: 8000, suffix: '-03-late' },
      { delay: 10000, suffix: '-04-end' },
    ]
  : [{ delay: 0, suffix: '' }];

for (const { delay, suffix } of captures) {
  if (delay > 0) await wait(delay);
  const out = suffix ? `${outBase}${suffix}.png` : OUT;
  console.log(`screenshotting to ${out}`);
  await page.screenshot({ path: out, fullPage: false });
}
console.log('screenshots done');

await browser.close();
dev.kill();
await wait(300);
console.log('exiting clean');
process.exit(0);
