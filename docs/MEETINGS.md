# NutraMEA Meetings — operator guide

Private video meetings for NutraMEA Intelligence members, with in-browser
recording and automatic meeting notes.

**Running cost: zero, permanently.** There is no provider recording API, no
metered service and no storage bill. No code path in this feature can create a
charge.

---

## 1. Run your first call

You need Chrome or Edge on a desktop or laptop. The other participant can use
any modern browser on any device — only the person recording needs Chromium.

1. Sign in at `nutrameaint.com` and open **My Account → Meetings**.
2. Your personal room is already filled in. Press **Copy invite** and send that
   link to the person you are meeting. *(Or press **New room** first if you want
   a one-off room for this call.)*
3. Press **Join meeting**.
4. When both of you are in, press **Record**.
   - Chrome asks what to share. Choose the **This tab** tab, select the meeting
     tab, and **tick "Also share tab audio"**.
   - This tick is what captures the other person's voice. Without it the
     recording contains only your own microphone. The app warns you if it is
     missing, but it is much easier to get right the first time.
   - Then choose where to save the file. Pick somewhere with a few GB free.
5. Talk. The recording timer and file size update live.
6. Press **Stop recording**, then **Leave**.
7. The summary screen shows your notes and every download.

An hour at 720p is roughly **540 MB**.

### Before a meeting that matters

Press **Check my setup before a meeting** on the meetings page. It records six
seconds through exactly the same capture the real recorder uses, then tells you
what was and was not captured and plays the sample back.

It exists for one reason: if the tab-audio tick is missed, the meeting sounds
completely normal throughout and the problem is only discovered on playback,
afterwards, when it cannot be fixed. The check surfaces it in six seconds
instead.

Run it once on the machine you will use, and listen to the playback.

---

## 2. What you get afterwards

| Artefact | Format | Contents |
|---|---|---|
| Recording | `.webm` | Full video and audio of the call |
| Notes | `.md` | Summary, decisions, action items with owners and due dates, open questions, risks |
| Transcript | `.txt` | Every line, timestamped and attributed |
| Subtitles | `.vtt` | Sidecar captions for the video |
| Data | `.json` | Everything above, machine-readable |
| Diagnostics | `.json` | Technical log with no meeting content — send this if something went wrong |

`.webm` plays in Chrome, Edge, Firefox and VLC. For a client who insists on
`.mp4`, convert with:

```bash
ffmpeg -i meeting.webm -c:v libx264 -crf 22 -c:a aac meeting.mp4
```

---

## 3. Where the recording lives

By default the file streams **straight to your computer** as you record. It is
never uploaded anywhere, and NutraMEA never stores it.

To get a shareable link instead, configure Google Drive (section 5). The file
then goes to the **member's own** free 15 GB Drive and the app returns an
"anyone with the link" URL. NutraMEA still pays nothing and stores nothing.

If the File System Access API is unavailable, the recording buffers in browser
storage instead and is offered as a download at the end. In that case download
it before clearing site data.

---

## 4. Install on nutrameaint.com

This is theme code, not a plugin. Nothing is installed through the Plugins
screen, nothing registers an activation hook, and no custom database table is
created. Two files go into the theme and one line goes into `functions.php`.

From this repository:

1. Copy `site/meet/` into the theme as `nutramea-meet/`:
   ```
   wp-content/themes/nutramea-theme/nutramea-meet/
       index.html
       assets/...
   ```
2. Copy `theme/nutramea-meetings.php` to:
   ```
   wp-content/themes/nutramea-theme/nutramea-meetings.php
   ```
3. Copy `theme/woocommerce/myaccount/dashboard.php` to:
   ```
   wp-content/themes/nutramea-theme/woocommerce/myaccount/dashboard.php
   ```
   This replaces WooCommerce's generic "Hello {name}, from your account
   dashboard you can view your recent orders…" page with a clean NutraMEA one.
   Skip this file if you would rather keep the stock dashboard — everything
   else works without it.
4. Add one line to the theme's `functions.php`:
   ```php
   require_once get_stylesheet_directory() . '/nutramea-meetings.php';
   ```
5. Visit **Settings → Permalinks** and press **Save Changes** once.

### Why a template file rather than a hook

WooCommerce's dashboard template prints its own greeting and then fires
`woocommerce_account_dashboard`. Hooking that action would **append** to the
boilerplate, leaving the page greeting the member twice. Overriding the
template replaces it, which is the documented WordPress way and stays theme
code.

### Where it appears

**Without WooCommerce** — the common case, and what nutrameaint.com runs:

- `/meetings/` is a standalone page, created by the theme. No page to add in
  WordPress, no shortcode needed. Invite links are `/meetings/<room>`.
- `[nutramea_meetings]` also works on any page, including an Elementor
  shortcode widget, if you would rather it live inside an existing member page.

**With WooCommerce**, additionally:

- **Meetings** appears in the My Account menu at `/my-account/meetings/`.

The standalone route is the primary path. An integration that only hooked
WooCommerce would install cleanly, raise no errors, and do nothing at all on a
site without it — the worst kind of failure, because nothing signals it.

### Pointing it at your own login page

Platforms usually have a branded login rather than `wp-login.php`:

```php
add_filter( 'nutramea_meetings_login_url', function () {
    return home_url( '/login/' );
} );
```

And to move the page itself:

```php
add_filter( 'nutramea_meetings_route', function () {
    return 'member-calls';   // -> /member-calls/
} );
```

The app is embedded in a same-origin iframe. That is deliberate: it keeps theme
CSS from interfering with the meeting interface, and vice versa.

Inside My Account the app runs in **embedded mode**: it hides its own logo,
site name and section eyebrow, because the site header and the account
navigation already provide all three. Opened directly, it shows them as normal.

Two files under `site/meet/` are development fixtures, not part of the theme:
`embed-harness.html` reproduces the My Account embed, and
`dashboard-preview.html` renders the dashboard using the theme's own CSS so it
can be reviewed without deploying.

### Requirements

- **HTTPS.** Camera, microphone and screen capture are all blocked on plain
  HTTP. Any live WordPress site already satisfies this.
- Nothing else. No API key, no account, no database table.

---

## 5. Configuration

Everything is set from code, through one filter in `functions.php`. There is no
admin screen to get out of sync with the source.

```php
add_filter( 'nutramea_meetings_config', function ( $config ) {
    // Optional: one-click upload to the member's own free Google Drive.
    $config['storage']['googleClientId'] = 'YOUR-ID.apps.googleusercontent.com';

    // Optional: self-host the call server later — nothing else changes.
    // $config['jitsi']['domain'] = 'meet.nutrameaint.com';

    // Optional: default to whole-room notes rather than your microphone only.
    // $config['notes']['engine'] = 'whisper';

    $config['quality'] = 720;   // 180 | 360 | 720 | 1080
    return $config;
} );
```

### Enabling Google Drive delivery

1. Google Cloud Console → **APIs & Services** → enable the **Google Drive API**.
2. **Credentials** → **Create OAuth client ID** → *Web application*.
3. Under **Authorised JavaScript origins** add `https://nutrameaint.com`.
4. Paste the client ID into the filter above.

The app requests the `drive.file` scope only — the narrowest Google offers. It
can see nothing in a member's Drive except the files it created itself.

---

## 6. The AI note taker

Two engines. Both free, both run entirely in the browser; no meeting content is
ever sent to a third party.

**"My microphone only"** (default) uses the browser's built-in recogniser.
Instant, no download. It transcribes **only what you say**, because the other
person's voice comes out of your speakers and echo cancellation deliberately
removes that from your microphone.

**"Everyone in the room"** runs Whisper locally on the recording's mixed audio,
so every participant is transcribed. It downloads a ~75 MB model once, then
works offline. It requires recording to be on, and notes start when you press
Record.

For a two-person call where you want both sides in the notes, choose
**Everyone in the room**.

From the transcript the app derives a summary, decisions, action items with
owners and due dates, open questions, risks, key topics and a timeline. This is
pattern-based extraction, not a language model: deterministic, free and
auditable. **Read the notes before circulating them.**

---

## 7. Weak and unstable connections

Voice is protected before anything else, because a frozen picture with clear
speech is a usable meeting and the reverse is not.

- **Audio-only entry.** Tick *Join audio-only* in the lobby, or press
  *Audio-only mode* during the call.
- **Automatic degradation.** The app steps 720p → 360p → 180p → audio-only as
  the link deteriorates, and climbs back as it recovers. Recovery is slower than
  degradation, so a brief dip does not cause flapping.
- **Opus DTX** stops transmitting during silence.
- **Simulcast** means one struggling participant is served a lower layer rather
  than degrading the call for everyone.
- For 1:1 calls the media goes **peer to peer**, which is the lowest-latency
  path available.

The connection indicator in the header shows the current assessment. Detailed
link statistics are not readable from an embedded call, so this combines the
browser's Network Information API with the call client's own adaptation.

---

## 8. Troubleshooting

**"I can hear myself but not the other person in the recording."**
Tab audio was not shared. Stop, press Record again, choose **This tab**, and
tick **Also share tab audio**. Run **Check my setup** first next time — it
catches exactly this.

**Recording is greyed out.** You are not on a Chromium browser, or not on a
desktop. The call still works — recording does not.

**The meeting will not connect.** Usually a corporate firewall blocking UDP.
Try another network or a phone hotspot; audio-only mode also has a better
chance of getting through.

**Live notes stopped partway.** The browser's recogniser ends its own sessions
constantly; the app restarts it automatically. After eight failed restarts it
gives up and says so. The call and the recording are never affected.

**The tab crashed mid-recording.** Reopen the meetings page. If the recording
was buffered in browser storage, a prompt offers to rebuild and download what
was captured. If it was streaming to disk, the file is already there and
playable up to the crash.

**Something else.** Press **Diagnostics** on the summary screen. It contains
technical events only — no transcript and no meeting content.

---

## 9. Sign-in, sign-up and activation are never touched

Authentication is the one thing that must work when everything else is broken,
so this feature registers **nothing at all** on those requests: `wp-login.php`
(which also serves registration, password reset and logout), `wp-signup.php`,
`wp-activate.php`, cron, XML-RPC and installation. There is no hook for it to
misbehave through.

Permalink registration runs on `admin_init` only, for a user who can manage
options, once per version — never on a front-end request. An earlier version
called `flush_rewrite_rules()` from `wp_loaded`, guarded only by an option
write. If that write ever failed to stick — a stale object-cache read, a
momentarily read-only database — the site regenerated every rewrite rule on
**every** request. That does not surface as an error message; it surfaces as
the site becoming slow enough to look broken, with sign-in the first casualty.

Rendering is fail-safe too. A failure in the meeting page degrades to one line
and leaves the rest of My Account working; a failure in the dashboard still
greets the member. Neither can blank the page.

`tests/php/auth-safety.test.php` locks all of this down, each case in its own
PHP process so one request's decisions cannot leak into the next. Run against
the pre-fix code, all fifteen fail.

## 10. Privacy and consent

- Recording requires an explicit confirmation, and a message is posted into the
  meeting chat announcing it. A red indicator stays visible throughout.
- Recordings are never uploaded to nutrameaint.com. They go to the member's own
  disk, or to the member's own Drive if they choose.
- Transcription runs in the browser. Meeting audio is not sent to any
  transcription service.
- Recording laws vary across the region. Announce recording verbally as well as
  on screen, and get agreement before you start.

---

## 11. Running the tests

```bash
npm run check      # everything below
npm run lint:js    # loads every module through the real ESM loader
npm run lint:php   # parses every PHP file
npm test           # JavaScript unit tests, then the WordPress suite
```

The WordPress suite (`tests/php/`) executes the theme integration against
stubbed WordPress and WooCommerce functions and asserts on what it produces:
hook registration, that the account menu never gains a second "Meetings" entry,
that dashboard links never repeat the featured card, that a signed-out visitor
gets a sign-in gate rather than the app, that the iframe carries the camera,
microphone and display-capture permissions, that personal rooms are stable and
not derivable from a member ID, and that a hostile display name cannot inject
markup. Linting proves a file parses; this proves it behaves.

### Verifying against real WordPress

The stub suite proves the code behaves correctly against WordPress **as we
understand it**. It cannot catch a misremembered function or a hook that does
not exist — the stub would be wrong in the same way as the code. Two checks
close that gap.

**API contract.** Extracts every function, hook and constant the theme code
actually uses and verifies each against real source:

```bash
curl -sSL -o wp.tar.gz https://wordpress.org/latest.tar.gz && tar xzf wp.tar.gz
curl -sSL -o wc.zip https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip && unzip -q wc.zip
WP_SRC=./wordpress WC_SRC=./woocommerce php tests/php/api-contract.test.php
```

**End to end.** Stands up a real WordPress with WooCommerce on SQLite (no
MySQL needed), installs the theme files exactly as section 4 describes, and
drives it in a browser as a signed-in member:

```bash
scripts/verify-wordpress.sh /tmp/nutramea-wp-verify 8090
BASE_URL=http://127.0.0.1:8090 node tests/e2e/wordpress.mjs
```

Neither runs in CI — the contract check needs source trees and the end-to-end
check needs a running site. Run both before a release, and after WooCommerce
updates.

Last verified against **WordPress 7.1.1** and **WooCommerce 11.1.1**:
55 contract checks and 28 end-to-end checks, all passing.

## 12. Why this architecture

**Why not the call provider's recording API?** Every hosted option is metered
or gated behind a paid plan — including Daily's local recording mode, which
reads as free but is a paid-plan feature. Browser-side recording is the only
route that is genuinely free and stays free.

**Why Jitsi as the default?** It needs no account, no API key and no credit
card, has no duration cap, and cannot generate a bill. It is a real SFU, so CPU
and bandwidth stay flat as participants are added. It is also self-hostable:
moving to `meet.nutrameaint.com` later is one line of configuration.

**Why stream recordings to disk?** A 60-minute recording is ~540 MB.
Accumulating that in a JavaScript array is the most common reason long browser
recordings die partway through — the tab is killed for memory. Each slice is
written out and immediately released, so memory stays flat for the whole hour.

**Why cap the rendered transcript?** An hour of speech is roughly 8,000 lines.
Keeping them all in the DOM makes scrolling stutter in the second half of a long
meeting. The DOM holds a bounded window; exports always use the full data.
