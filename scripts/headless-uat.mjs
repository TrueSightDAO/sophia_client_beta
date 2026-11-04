// scripts/headless-uat.mjs — Playwright smoke test of the client UI.
// Loads the page, captures console/page errors, exercises the auth + channel
// management + send flows, and asserts the DOM reacts as expected.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8000';

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const results = [];
function check(name, cond) {
  results.push({ name, pass: !!cond });
  console.log((cond ? '✅' : '❌') + ' ' + name);
}

// 1. boot
check('app title rendered', (await page.textContent('#appTitle')).length > 0);
check('guest sees only public channels (1 = lobby)', (await page.locator('.channel').count()) === 1);
check('new-channel button hidden before connect', await page.locator('#newChannelBtn').isHidden());

// 2. connect (auto-connects if a key exists; else click)
if (await page.locator('#connectBtn').isVisible()) {
  await page.click('#connectBtn');
  await page.waitForTimeout(1500);
}
check('composer visible after connect', await page.locator('#composer').isVisible());
check('new-channel button visible after connect', await page.locator('#newChannelBtn').isVisible());
check('identity shows a fingerprint', (await page.textContent('#identity')).indexOf('identity:') === 0);
check('governor sees all 3 channels after connect', (await page.locator('.channel').count()) === 3);

// 3. create a channel
await page.click('#newChannelBtn');
check('channel modal opens', await page.locator('#channelModal').isVisible());
await page.fill('#channelName', 'uat-test-channel');
await page.fill('#channelCategory', 'UAT');
await page.click('#channelCreateBtn');
await page.waitForTimeout(300);
check('modal closed after create', await page.locator('#channelModal').isHidden());
check('created channel appears', (await page.locator('.channel', { hasText: 'uat-test-channel' }).count()) === 1);

// 4. retire the channel
const created = page.locator('.channel', { hasText: 'uat-test-channel' });
await created.hover();
await created.locator('.channel-retire').click();
await page.waitForTimeout(300);
check('retired channel removed', (await page.locator('.channel', { hasText: 'uat-test-channel' }).count()) === 0);

// 5. attach button + send (send will 403 for a non-governor key, but must not throw a JS error)
await page.click('.channel', { position: { x: 5, y: 5 } }); // re-select first channel (retire cleared the active one)
await page.waitForTimeout(500);
const hadPageError = pageErrors.length;
await page.fill('#messageInput', 'UAT smoke test');
await page.click('#sendBtn');
await page.waitForTimeout(3000);
check('no new page errors during send', pageErrors.length === hadPageError);
const msgCount = await page.locator('.msg').count();
check('messages rendered (you + reply/error bubble)', msgCount >= 2);

console.log('\n=== console errors ===');
consoleErrors.forEach((e) => console.log('  ' + e));
console.log('=== page errors ===');
pageErrors.forEach((e) => console.log('  ' + e));

const failed = results.filter((r) => !r.pass).length;
console.log('\n' + results.length + ' checks, ' + failed + ' failed' +
  (consoleErrors.length || pageErrors.length ? ' (+ console/page errors above)' : ''));
await browser.close();
process.exit(failed || consoleErrors.length || pageErrors.length ? 1 : 0);
