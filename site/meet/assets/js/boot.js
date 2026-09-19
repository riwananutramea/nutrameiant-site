/**
 * Entry point.
 *
 * Kept as a file rather than an inline <script> so the page's Content-Security
 * Policy can use `script-src 'self'` without `'unsafe-inline'`. An inline
 * bootstrap would force the policy open for every inline script on the page,
 * which is most of what a CSP is there to prevent.
 */
import { MeetApp } from './ui/app.js';

const app = new MeetApp();

app.init().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  document.body.replaceChildren(
    Object.assign(document.createElement('p'), {
      className: 'fatal',
      textContent: `This meeting page could not start: ${error.message}`,
    }),
  );
});

// Exposed for support: lets an operator pull diagnostics from the console.
window.nutrameaMeet = app;
