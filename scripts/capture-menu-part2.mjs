// Capture the new Phase 5.5 part 2 menu screenshots: a player view (with
// attribute stars + portrait + spray chart) and the live view (WP chart).
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5180;
const URL = `http://localhost:${PORT}/`;

const CANDIDATE_PATHS = [
  '/home/gregtom3/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
];
let chromiumPath;
for (const p of CANDIDATE_PATHS) {
  if (existsSync(p)) { chromiumPath = p; break; }
}

console.log('starting vite...');
const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
dev.stdout.on('data', (buf) => { if (buf.toString().includes('Local:')) ready = true; });
dev.stderr.on('data', (buf) => process.stderr.write('vite: ' + buf.toString()));
for (let i = 0; i < 60 && !ready; i++) await wait(500);
if (!ready) { console.error('vite never reported ready'); dev.kill(); process.exit(1); }
await wait(800);

const browser = await chromium.launch({
  headless: true,
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.error('console error:', msg.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
await wait(1500);

// League view (with awards-watch row).
await page.keyboard.press('Tab');
await wait(500);
await page.screenshot({ path: 'docs/screenshots/menu-league-part2.png', fullPage: false });
console.log('saved menu-league-part2.png');

// Teams index → team detail.
await page.keyboard.press('2');
await wait(300);
const teamCard = await page.$('button.team-card');
if (teamCard) await teamCard.click();
await wait(400);
await page.screenshot({ path: 'docs/screenshots/menu-team.png', fullPage: false });
console.log('saved menu-team.png');

// Click Projections tab.
await page.click('button[data-tab="projections"]');
await wait(500);
await page.screenshot({ path: 'docs/screenshots/menu-team-projections.png', fullPage: false });
console.log('saved menu-team-projections.png');

// Players: pick the first player card.
await page.keyboard.press('3');
await wait(400);
const card = await page.$('button.player-card-mini');
if (card) await card.click();
await wait(400);
await page.screenshot({ path: 'docs/screenshots/menu-player.png', fullPage: false });
console.log('saved menu-player.png');

// Live view (WP chart + sparklines).
await page.keyboard.press('4');
await wait(400);
await page.screenshot({ path: 'docs/screenshots/menu-live.png', fullPage: false });
console.log('saved menu-live.png');

await browser.close();
dev.kill();
await wait(300);
process.exit(0);
