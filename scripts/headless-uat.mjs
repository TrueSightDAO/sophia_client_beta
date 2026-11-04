// scripts/headless-uat.mjs — Playwright smoke test of the client UI.
// Injects a real sentinel keypair (from ~/Applications/deepseek_dao_identity/.env)
// so the client authenticates as a sentinel and the full flow is exercised:
// channel visibility, deep-link, channel/category management, and send.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:8000';

// Load the DeepSeek sentinel keypair (values never printed).
const env = readFileSync(join(homedir(), 'Applications', 'deepseek_dao_identity', '.env'), 'utf8');
const kv = {};
for (const line of env.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const PUBLIC_KEY = kv.PUBLIC_KEY;
const PRIVATE_KEY = kv.PRIVATE_KEY;

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(err.message));

// Seed the sentinel keypair before the app loads so it authenticates as sentinel.
await page.addInitScript(({ pub, priv }) => {
  localStorage.setItem('publicKey', pub);
  localStorage.setItem('privateKey', priv);
}, { pub: PUBLIC_KEY, priv: PRIVATE_KEY });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const results = [];
function check(name, cond) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '✅' : '❌') + ' ' + name);
}

// 1. boot + auto-connect as sentinel
check('app title rendered', (await page.textContent('#appTitle')).length > 0);
check('composer visible (auto-connected as sentinel)', await page.locator('#composer').isVisible());
check('sentinel sees all 3 channels', (await page.locator('.channel').count()) === 3);
const identity = await page.textContent('#identity');
check('identity shows a fingerprint', identity.indexOf('identity:') === 0);
check('role is sentinel (not governor)', (await page.textContent('#authBanner')).indexOf('sentinel') !== -1);

// 2. deep-link: click a channel → URL hash updates; reload → same channel active
await page.locator('.channel', { hasText: 'sophia-commands' }).locator('.channel-name').click();
await page.waitForTimeout(400);
check('URL hash updates on channel click', page.url().indexOf('#channel=sophia-commands') !== -1);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('same channel reactivated on reload', (await page.locator('.channel.active').textContent()).indexOf('sophia-commands') !== -1);

// 3. create a category
await page.click('#newCategoryBtn');
await page.fill('#categoryName', 'UAT');
await page.click('#categoryCreateBtn');
await page.waitForTimeout(2000);
check('category appears in sidebar', (await page.locator('.category', { hasText: 'UAT' }).count()) === 1);

// 4. create a channel under that category (dropdown)
await page.click('#newChannelBtn');
check('category dropdown populated', (await page.locator('#channelCategory option').count()) >= 3);
await page.fill('#channelName', 'uat-test-channel');
await page.selectOption('#channelCategory', 'UAT');
await page.click('#channelCreateBtn');
await page.waitForTimeout(2000);
check('created channel appears', (await page.locator('.channel', { hasText: 'uat-test-channel' }).count()) === 1);

// 5. retire the channel
const created = page.locator('.channel', { hasText: 'uat-test-channel' });
await created.hover();
await created.locator('.channel-retire').click();
await page.waitForTimeout(2000);
check('retired channel removed', (await page.locator('.channel', { hasText: 'uat-test-channel' }).count()) === 0);

// 6. send a message and confirm a reply (sentinel has full rights)
await page.locator('.channel', { hasText: 'general' }).locator('.channel-name').click();
await page.waitForTimeout(500);
await page.fill('#messageInput', 'UAT test — reply with just the word pong.');
await page.click('#sendBtn');
await page.waitForTimeout(8000);
const text = await page.locator('.msg.sophia .bubble').last().textContent();
check('got a non-empty Sophia reply', text && text.trim().length > 0 && text.indexOf('Error') === -1);

console.log('\n=== console errors ===');
consoleErrors.forEach((e) => console.log('  ' + e));
console.log('=== page errors ===');
pageErrors.forEach((e) => console.log('  ' + e));

const failed = results.filter((r) => !r.pass).length;
console.log('\n' + results.length + ' checks, ' + failed + ' failed' +
  (consoleErrors.length || pageErrors.length ? ' (+ console/page errors above)' : ''));
await browser.close();
process.exit(failed || consoleErrors.length || pageErrors.length ? 1 : 0);
