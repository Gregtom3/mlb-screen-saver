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
await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
console.log('navigation complete; waiting 8s for sim to play out');
await wait(8000);

console.log(`screenshotting to ${OUT}`);
await page.screenshot({ path: OUT, fullPage: false });
console.log('screenshot done');

await browser.close();
dev.kill();
await wait(300);
console.log('exiting clean');
process.exit(0);
