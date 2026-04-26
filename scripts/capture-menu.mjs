// Capture the stats menu open in headless Chromium.
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5179;
const URL = `http://localhost:${PORT}/`;
const OUT = process.argv[2] ?? 'docs/screenshots/menu-league.png';

console.log('starting vite...');
const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ready = false;
dev.stdout.on('data', (buf) => {
  const s = buf.toString();
  if (s.includes('Local:')) ready = true;
});
dev.stderr.on('data', (buf) => process.stderr.write('vite stderr: ' + buf.toString()));

for (let i = 0; i < 60 && !ready; i++) await wait(500);
if (!ready) {
  console.error('vite never reported ready');
  dev.kill();
  process.exit(1);
}
await wait(800);

const CHROMIUM_PATH = '/home/gregtom3/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

page.on('pageerror', (e) => console.error('page error:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
await wait(1500);
// Open the menu via Tab.
await page.keyboard.press('Tab');
await wait(500);
console.log(`screenshotting league view to ${OUT}`);
await page.screenshot({ path: OUT, fullPage: false });

// Players view.
await page.keyboard.press('3');
await wait(300);
const playersOut = OUT.replace(/\.png$/, '-players.png');
await page.screenshot({ path: playersOut, fullPage: false });
console.log(`screenshotting players view to ${playersOut}`);

await browser.close();
dev.kill();
await wait(300);
process.exit(0);
