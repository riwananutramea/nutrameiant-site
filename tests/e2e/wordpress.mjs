/**
 * End-to-end verification against a real WordPress + WooCommerce install.
 *
 * Stand the site up first:
 *   scripts/verify-wordpress.sh /tmp/nutramea-wp-verify 8090
 *   BASE_URL=http://127.0.0.1:8090 node tests/e2e/wordpress.mjs
 *
 * The stub suite in tests/php proves the theme code behaves correctly against
 * WordPress as we understand it. This proves the understanding: that the
 * endpoint really registers, that the template override really replaces
 * WooCommerce's dashboard rather than appending to it, and that a signed-in
 * member really lands on a working meeting page.
 *
 * Requires Playwright. Not part of `npm test`, because it needs a running
 * site — run it before a release, or after WooCommerce updates.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8090';
const MEMBER = { user: 'member', pass: 'memberpass123', name: 'Riwana Elshawadfi', first: 'Riwana' };

let passed = 0;
let failed = 0;
const problems = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    problems.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.includes('favicon') || text.includes('ERR_CERT')) return;
  errors.push(text.slice(0, 160));
});

try {
  /* ------------------------------------------------- authentication paths */
  // These must work when everything else is broken. This feature registers
  // nothing at all on them (see tests/php/auth-safety.test.php); these checks
  // confirm that holds on a real site with the feature active.
  console.log('\nauthentication');
  for (const [label, path] of [
    ['the sign-in page loads', '/wp-login.php'],
    ['password reset loads', '/wp-login.php?action=lostpassword'],
    ['registration loads', '/wp-login.php?action=register'],
    ['activation loads', '/wp-activate.php'],
  ]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    // Registration may be disabled by policy, which redirects rather than
    // errors. A 5xx, or our markup appearing here, is the real failure.
    const ours = await page.evaluate(() => Boolean(
      document.querySelector('.nutramea-dash, .nutramea-meet, iframe.nutramea-meet__frame'),
    ));
    check(label, status < 500 && !ours, `status ${status}${ours ? ', our markup leaked onto an auth page' : ''}`);
  }

  const adminPage = await context.newPage();
  await adminPage.goto(`${BASE}/wp-login.php`, { waitUntil: 'domcontentloaded' });
  await adminPage.fill('#user_login', 'admin');
  await adminPage.fill('#user_pass', 'adminpass123');
  await adminPage.click('#wp-submit');
  await adminPage.waitForLoadState('domcontentloaded');
  await adminPage.goto(`${BASE}/wp-admin/`, { waitUntil: 'domcontentloaded' });
  const inAdmin = await adminPage.evaluate(() => Boolean(
    document.getElementById('adminmenu') || document.getElementById('wpadminbar'),
  ));
  check('an administrator can sign in and reach wp-admin', inAdmin, adminPage.url());
  await adminPage.close();
  await context.clearCookies();

  /* ------------------------------------------------------------- sign in */
  console.log(`\nSigning in at ${BASE}`);
  await page.goto(`${BASE}/wp-login.php`, { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', MEMBER.user);
  await page.fill('#user_pass', MEMBER.pass);
  await page.click('#wp-submit');
  await page.waitForLoadState('domcontentloaded');
  check('the member can sign in', !page.url().includes('wp-login'), page.url());

  /* ----------------------------------------------------------- dashboard */
  console.log('\n/my-account/');
  await page.goto(`${BASE}/my-account/`, { waitUntil: 'networkidle' });
  const dash = await page.evaluate(() => ({
    ours: Boolean(document.querySelector('.nutramea-dash')),
    greeting: document.querySelector('.nutramea-dash__greeting')?.textContent?.trim(),
    greetingCount: (document.body.innerText.match(/Hello[, ]/g) || []).length,
    stockBoilerplate: document.body.innerText.includes('from your account dashboard'),
    ctaHref: document.querySelector('.nutramea-dash__cta')?.getAttribute('href') || '',
    secondary: [...document.querySelectorAll('.nutramea-dash__link')].map((a) => a.textContent.trim()),
    nav: [...document.querySelectorAll('.woocommerce-MyAccount-navigation a')].map((a) => a.textContent.trim()),
  }));

  check('our dashboard replaced the WooCommerce one', dash.ours && !dash.stockBoilerplate);
  check('the member is greeted exactly once', dash.greetingCount === 1, `found ${dash.greetingCount}`);
  check('the greeting uses their first name', dash.greeting === `Hello, ${MEMBER.first}`, dash.greeting);
  check('the primary action points at the meetings endpoint', dash.ctaHref.endsWith('/my-account/meetings/'), dash.ctaHref);
  check('"Meetings" appears once in the navigation',
    dash.nav.filter((i) => i === 'Meetings').length === 1, dash.nav.join(', '));
  check('"Log out" is still last', dash.nav.at(-1) === 'Log out', dash.nav.at(-1));
  check('secondary links do not repeat the featured card',
    !dash.secondary.includes('Meetings'), dash.secondary.join(', '));
  check('secondary links do not repeat the page itself or log out',
    !dash.secondary.includes('Dashboard') && !dash.secondary.includes('Log out'),
    dash.secondary.join(', '));
  check('secondary links are real account sections', dash.secondary.length > 0, dash.secondary.join(', '));

  /* ------------------------------------------------------------ meetings */
  console.log('\n/my-account/meetings/');
  await page.goto(`${BASE}/my-account/meetings/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const meet = await page.evaluate(() => {
    const frame = document.querySelector('iframe.nutramea-meet__frame');
    return {
      frames: document.querySelectorAll('iframe').length,
      allow: frame?.getAttribute('allow') || '',
      src: frame?.getAttribute('src') || '',
      activeNav: document.querySelector('.woocommerce-MyAccount-navigation .is-active a')?.textContent?.trim(),
    };
  });

  check('the endpoint resolves and embeds the app once', meet.frames === 1, `${meet.frames} frames`);
  for (const permission of ['camera', 'microphone', 'display-capture']) {
    check(`the frame is granted ${permission}`, meet.allow.includes(permission), meet.allow);
  }
  check('the frame carries room and configuration',
    /room=/.test(meet.src) && /cfg=/.test(meet.src));
  check('the Meetings nav item is marked active', meet.activeNav === 'Meetings', meet.activeNav);

  const appFrame = page.frames().find((f) => f.url().includes('nutramea-meet'));
  check('the app frame loaded', Boolean(appFrame));

  if (appFrame) {
    const inner = await appFrame.evaluate(() => ({
      screen: document.body.dataset.screen,
      embedded: document.body.dataset.embedded,
      brandVisible: Boolean(document.querySelector('.topbar__brand')?.offsetParent),
      logos: document.querySelectorAll('.logo').length,
      room: document.getElementById('room-name')?.value || '',
      name: document.getElementById('display-name')?.value || '',
      joinReady: !document.getElementById('join-button')?.disabled,
      hasPreflight: Boolean(document.getElementById('preflight-button')),
    }));

    check('the app reached the lobby', inner.screen === 'lobby', inner.screen);
    check('the app is in embedded mode', inner.embedded === 'true');
    check('the app hides its duplicate branding', !inner.brandVisible);
    check('only one logo is on the page', inner.logos === 1, `${inner.logos} logos`);
    check('the personal room is prefilled and unguessable',
      /^room-[a-f0-9]{20}$/.test(inner.room), inner.room);
    check('the display name comes from WordPress', inner.name === MEMBER.name, inner.name);
    check('the member can join', inner.joinReady);
    check('the setup check is offered', inner.hasPreflight);
  }

  /* ----------------------------------------------------------- signed out */
  console.log('\nsigned out');
  await context.clearCookies();
  await page.goto(`${BASE}/my-account/meetings/`, { waitUntil: 'networkidle' });
  const out = await page.evaluate(() => ({
    frames: document.querySelectorAll('iframe').length,
    login: Boolean(document.querySelector('form.woocommerce-form-login, #loginform')),
  }));
  check('the app is not served to a signed-out visitor', out.frames === 0, `${out.frames} frames`);
  check('a signed-out visitor is asked to sign in', out.login);

  /* -------------------------------------------------------------- errors */
  console.log('\nconsole');
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (problems.length) {
  console.log('\nProblems:');
  for (const problem of problems) console.log(`  · ${problem}`);
}
process.exit(failed > 0 ? 1 : 0);
