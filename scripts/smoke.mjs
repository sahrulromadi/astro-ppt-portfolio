// Headless smoke test for deck navigation via Chrome DevTools Protocol. No deps (Node 24).
// Usage: npm run dev   (in another terminal; BASE=<url> to test another server, e.g. a Vercel preview)
//        node scripts/smoke.mjs [screenshotDir]
// Set CHROME=<path to chrome/msedge> if Chrome is not at the default Windows path.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.argv[2];
const BASE = process.env.BASE ?? 'http://localhost:4321/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  '--window-size=1366,768',
  '--enable-unsafe-swiftshader', // WebGL for the intro scene without a GPU
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'smoke-'))}`,
  'about:blank',
]);
let page;
for (let i = 0; i < 30 && !page; i++) {
  await sleep(300);
  try {
    page = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = []; // uncaught exceptions in the page
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d.result ?? d), pending.delete(d.id);
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
const state = () =>
  js(`({ counter: document.querySelector('.counter').textContent, hash: location.hash,
        live: [...document.querySelectorAll('.slide')].filter(s => !s.inert).map(s => s.id) })`);
const key = async (key, code, vk, shift = false) => {
  const base = { key, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(1600);
};
const load = async (url) => {
  await send('Page.navigate', { url });
  await sleep(1200);
};
const shot = async (name) => {
  if (!OUT) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
};

let failures = 0;
const expect = async (label, want) => {
  const s = await state();
  const ok = s.counter === want.counter && s.hash === want.hash && s.live.length === 1;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(s)}`);
};

await send('Page.enable');
await send('Runtime.enable');
await load(BASE);
const total = await js(`document.querySelectorAll('.slide').length`);
const lastId = await js(`[...document.querySelectorAll('.slide')].at(-1).id`);
await expect('initial', { counter: `1 / ${total}`, hash: '#intro' });

// Intro: the 3D scene plays on load, finishes with every form stored, and restarts when you come back.
const intro = () =>
  js(`({ caption: document.querySelector('.intro-caption').textContent, stored: document.querySelector('[data-count]').textContent,
        ended: document.querySelector('.intro-end').classList.contains('on') })`);
for (const [ms, name] of [[0, 'desktop-0a-boot'], [2800, 'desktop-0b-scanner'], [2800, 'desktop-0c-stream'], [2600, 'desktop-0d-network']]) {
  await sleep(ms);
  await shot(name);
}
await sleep(3000);
const ended = await intro();
const endedOk = ended.ended && ended.stored === '24 / 24' && ended.caption === 'Connected. Visible. Trusted.';
if (!endedOk) failures++;
console.log(`${endedOk ? 'PASS' : 'FAIL'} intro plays to the end: ${JSON.stringify(ended)}`);
await shot('desktop-1-intro-end');
// Mouse over the scene: parallax, floor spotlight and particle trail.
for (let i = 0; i < 12; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300 + i * 60, y: 430 + (i % 3) * 20 });
  await sleep(40);
}
await sleep(200);
await shot('desktop-1b-cursor');

await key('ArrowRight', 'ArrowRight', 39);
await expect('ArrowRight', { counter: `2 / ${total}`, hash: '#home' });
await shot('desktop-2-cover');
await key(' ', 'Space', 32);
await expect('Space', { counter: `3 / ${total}`, hash: '#experience' });
await key(' ', 'Space', 32, true);
await expect('Shift+Space', { counter: `2 / ${total}`, hash: '#home' });
await key('End', 'End', 35);
await expect('End', { counter: `${total} / ${total}`, hash: `#${lastId}` });
await shot('desktop-3-contact');
await key('Home', 'Home', 36);
await expect('Home', { counter: `1 / ${total}`, hash: '#intro' });
const replay = await intro();
const replayOk = !replay.ended && replay.stored === '0 / 24';
if (!replayOk) failures++;
console.log(`${replayOk ? 'PASS' : 'FAIL'} intro restarts when shown again: ${JSON.stringify(replay)}`);

// One wheel gesture (20 events, ~16 ms apart, like trackpad inertia) = one slide.
for (let i = 0; i < 20; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 300, deltaX: 0, deltaY: 60 - i * 2 });
  await sleep(16);
}
await sleep(900);
await expect('wheel gesture', { counter: `2 / ${total}`, hash: '#home' });

// Next button, then dot click.
await js(`document.querySelector('[data-step="1"]').click()`);
await sleep(900);
await expect('next button', { counter: `3 / ${total}`, hash: '#experience' });
await js(`document.querySelectorAll('.dots button')[4].click()`);
await sleep(1200);
await expect('dot 5', { counter: `5 / ${total}`, hash: (await js(`'#' + document.querySelectorAll('.slide')[4].id`)) });
await shot('desktop-4-project');

// Deep link.
await load(`${BASE}#contact`);
await expect('deep link #contact', { counter: `${total} / ${total}`, hash: '#contact' });

// Overview: O opens the grid, clicking a thumbnail jumps there, Esc returns to the same slide.
await load(`${BASE}#experience`);
await key('o', 'KeyO', 79);
const ov = await js(`({ on: document.documentElement.classList.contains('overview'),
  clickable: [...document.querySelectorAll('.slide')].filter(s => !s.inert && s.tabIndex === 0).length,
  contentInert: [...document.querySelectorAll('.slide-inner')].every(e => e.inert) })`);
const ovOk = ov.on && ov.clickable === total && ov.contentInert;
if (!ovOk) failures++;
console.log(`${ovOk ? 'PASS' : 'FAIL'} O opens overview: ${JSON.stringify(ov)}`);
await shot('desktop-5-overview');
const fourth = await js(`'#' + document.querySelectorAll('.slide')[3].id`);
await js(`document.querySelectorAll('.slide')[3].click()`);
await sleep(900);
await expect('overview → click thumbnail 4', { counter: `4 / ${total}`, hash: fourth });
await key('o', 'KeyO', 79);
await key('Escape', 'Escape', 27);
await expect('overview → Esc keeps slide 4', { counter: `4 / ${total}`, hash: fourth });
const ovOff = !(await js(`document.documentElement.classList.contains('overview')`));
if (!ovOff) failures++;
console.log(`${ovOff ? 'PASS' : 'FAIL'} overview closed`);

// Tab stays inside the active slide (or the nav bar).
await load(BASE);
let tabOk = true;
for (let i = 0; i < 8; i++) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const where = await js(`document.activeElement.closest('.slide')?.id ?? 'outside-slide'`);
  if (where !== 'intro' && where !== 'outside-slide') tabOk = false;
}
if (!tabOk) failures++;
console.log(`${tabOk ? 'PASS' : 'FAIL'} Tab stays in active slide`);

// Reduced motion.
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const sb = await js(`getComputedStyle(document.querySelector('.deck')).scrollBehavior`);
if (sb !== 'auto') failures++;
console.log(`${sb === 'auto' ? 'PASS' : 'FAIL'} reduced motion → scroll-behavior ${sb}`);
await send('Emulation.setEmulatedMedia', { features: [] });

// Phone viewport screenshots.
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
await load(`${BASE}#intro`);
await sleep(5000); // mid-way: cubes streaming into the server
await shot('phone-0a-intro');
await sleep(7000);
await shot('phone-0b-intro-end');
for (const [hash, name] of [['#home', 'phone-1-cover'], ['#applications', 'phone-2-applications'], [`#${await js(`document.querySelectorAll('.slide')[4].id`)}`, 'phone-3-project'], ['#contact', 'phone-4-contact']]) {
  await load(`${BASE}${hash}`);
  await shot(name);
}
const overflow = await js(`[...document.querySelectorAll('.slide')].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.id)`);
if (overflow.length) failures++;
console.log(`${overflow.length ? 'FAIL' : 'PASS'} no horizontal overflow inside slides at 360px ${JSON.stringify(overflow)}`);

if (errors.length) failures++;
console.log(`${errors.length ? 'FAIL' : 'PASS'} no uncaught page errors ${JSON.stringify(errors)}`);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
ws.close();
chrome.kill();
process.exit(failures ? 1 : 0);
