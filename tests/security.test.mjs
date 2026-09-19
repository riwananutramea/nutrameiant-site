import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfig, sanitisePackedConfig, isTrustedDomain, decodePackedConfig, mergeConfig,
  readTrustedConfig,
  TRUSTED_DOMAINS,
} from '../site/meet/assets/js/config.js';

/**
 * The `cfg` query parameter is attacker-controllable.
 *
 * The app's index.html is a static file inside the theme, so anyone can send a
 * member a link to it carrying any `cfg` they like. `cfg` sets the transport
 * domain, and the transport domain is interpolated into a <script src>.
 *
 * Unfiltered, that is arbitrary script execution on the site's own origin, as
 * the signed-in member. These tests pin the allowlist that closes it.
 */

const pack = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');

test('an attacker-chosen transport domain is rejected', () => {
  const config = buildConfig({ search: `?cfg=${pack({ jitsi: { domain: 'attacker.example.test' } })}` });
  assert.equal(config.jitsi.domain, 'meet.jit.si', 'fell back to the trusted default');
  assert.ok(TRUSTED_DOMAINS.includes(config.jitsi.domain));
});

test('lookalike and malformed hosts are rejected', () => {
  for (const host of [
    'meet.jit.si.evil.com',      // suffix attack
    'evil.com/meet.jit.si',      // path
    'evil.com#meet.jit.si',      // fragment
    'evil.com?x=meet.jit.si',    // query
    'meet.jit.si:8080',          // port
    'user@meet.jit.si',          // credentials
    'https://meet.jit.si',       // scheme
    'meet.jit.si ',              // trailing space
    '//evil.com',                // protocol-relative
    '',
    'localhost',                 // no dot, not on the list
    '127.0.0.1',
  ]) {
    assert.equal(isTrustedDomain(host), false, `should reject ${JSON.stringify(host)}`);
  }
});

test('the documented transports are accepted, case-insensitively', () => {
  assert.equal(isTrustedDomain('meet.jit.si'), true);
  assert.equal(isTrustedDomain('8x8.vc'), true);
  assert.equal(isTrustedDomain('MEET.JIT.SI'), true);
});

test('a server-configured self-hosted domain stays usable', () => {
  // The server renders this inline; it did not come from the URL.
  const injected = { jitsi: { domain: 'meet.nutrameaint.com' } };
  const config = buildConfig({
    injected,
    search: `?cfg=${pack({ jitsi: { domain: 'meet.nutrameaint.com' } })}`,
  });
  assert.equal(config.jitsi.domain, 'meet.nutrameaint.com');
  // But that trust does not extend to anything else in the URL.
  const hijacked = buildConfig({
    injected,
    search: `?cfg=${pack({ jitsi: { domain: 'attacker.example.test' } })}`,
  });
  assert.equal(hijacked.jitsi.domain, 'meet.nutrameaint.com');
});

test('unknown keys in cfg are dropped entirely', () => {
  const out = sanitisePackedConfig({
    recording: { maxDurationMs: 1 },
    storage: { googleScope: 'https://www.googleapis.com/auth/drive' },
    somethingElse: true,
  });
  assert.deepEqual(out, {}, 'only allowlisted keys may pass');
});

test('a wider Drive scope cannot be injected through cfg', () => {
  // drive.file limits the app to files it created. Widening it from a URL
  // would let a crafted link ask a member for access to their whole Drive.
  const config = buildConfig({
    search: `?cfg=${pack({ storage: { googleScope: 'https://www.googleapis.com/auth/drive' } })}`,
  });
  assert.equal(config.storage.googleScope, 'https://www.googleapis.com/auth/drive.file');
});

test('no Google OAuth client can be supplied through the URL', () => {
  // Validating the SHAPE of a client ID is not enough: an attacker can
  // register a real OAuth application and get a genuinely well-formed ID, then
  // raise a real Google consent screen from this site for an app they control.
  for (const id of ['evil.attacker.test', 'EVIL123-abc.apps.googleusercontent.com']) {
    const config = buildConfig({ search: `?cfg=${pack({ storage: { googleClientId: id } })}` });
    assert.equal(config.storage.googleClientId, '', `must not honour ${id}`);
  }
});

test('Drive settings come only from the trusted channel', () => {
  const injected = { storage: { googleClientId: 'real-id.apps.googleusercontent.com' } };
  const config = buildConfig({
    injected,
    // A crafted link cannot displace the server's value.
    search: `?cfg=${pack({ storage: { googleClientId: 'EVIL.apps.googleusercontent.com' } })}`,
  });
  assert.equal(config.storage.googleClientId, 'real-id.apps.googleusercontent.com');
});

test('the trusted channel is read from a same-origin framing page', () => {
  const parentConfig = { storage: { googleClientId: 'from-parent.apps.googleusercontent.com' } };
  // Standalone: the app's own global.
  const standalone = { NUTRAMEA_MEET_CONFIG: parentConfig };
  standalone.parent = standalone;
  assert.equal(readTrustedConfig(standalone), parentConfig);

  // Framed same-origin: readable through the parent.
  const framed = { parent: { NUTRAMEA_MEET_CONFIG: parentConfig } };
  assert.equal(readTrustedConfig(framed), parentConfig);

  // Framed cross-origin: touching parent throws, so trust nothing.
  const hostile = { get parent() { throw new Error('SecurityError'); } };
  assert.equal(readTrustedConfig(hostile), null);

  assert.equal(readTrustedConfig(undefined), null);
  assert.equal(readTrustedConfig({ parent: {} }), null);
});

test('invalid values are dropped rather than coerced', () => {
  const config = buildConfig({
    search: `?cfg=${pack({ quality: 99999, provider: 'evil', notes: { engine: 'rm -rf' } })}`,
  });
  assert.equal(config.quality, 720, 'kept the default');
  assert.equal(config.provider, 'jitsi');
  assert.equal(config.notes.engine, 'webspeech');
});

test('valid presentation settings still come through', () => {
  const config = buildConfig({
    search: `?cfg=${pack({
      embedded: true,
      brandName: 'NutraMEA Intelligence',
      quality: 1080,
      notes: { engine: 'whisper', lang: 'ar-AE' },
      jitsi: { domain: '8x8.vc', roomPrefix: 'NutraMEAInt' },
    })}`,
  });
  assert.equal(config.embedded, true);
  assert.equal(config.brandName, 'NutraMEA Intelligence');
  assert.equal(config.quality, 1080);
  assert.equal(config.notes.engine, 'whisper');
  assert.equal(config.notes.lang, 'ar-AE');
  assert.equal(config.jitsi.domain, '8x8.vc');
  assert.equal(config.jitsi.roomPrefix, 'NutraMEAInt');
});

test('prototype pollution through cfg is still blocked', () => {
  const polluted = Buffer.from('{"__proto__":{"polluted":true},"brandName":"x"}').toString('base64url');
  buildConfig({ search: `?cfg=${polluted}` });
  assert.equal({}.polluted, undefined);
  mergeConfig({}, JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'));
  assert.equal({}.polluted, undefined);
});

test('a malformed cfg never throws during page load', () => {
  for (const value of ['!!!!', '', 'null', Buffer.from('"a string"').toString('base64url')]) {
    assert.doesNotThrow(() => buildConfig({ search: `?cfg=${value}` }));
  }
  assert.equal(decodePackedConfig('!!!!'), null);
});
