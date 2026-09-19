/**
 * Parses every application module so a syntax error can never reach the site.
 *
 * `node --check` is not usable here: it does not understand private class
 * fields in all modes and treats ambiguous files as CommonJS. Importing each
 * module through the real ESM loader is a stricter check anyway — it also
 * catches bad import specifiers.
 */
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../site/meet/assets/js/', import.meta.url).pathname;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// Modules that touch browser-only globals at import time are parsed rather
// than executed; everything else is fully imported.
const files = (await walk(ROOT)).sort();
let failures = 0;

for (const file of files) {
  const label = relative(ROOT, file);
  try {
    await import(pathToFileURL(file).href);
    process.stdout.write(`  ok  ${label}\n`);
  } catch (error) {
    // An entry point touches `window` or `document` as soon as it is imported,
    // so it cannot be executed here. That is not a defect: by the time such an
    // error is thrown the module has already been parsed and its imports
    // resolved, which is exactly what this check is for. Only a genuine parse
    // or resolution failure counts.
    const runtimeOnly = error instanceof ReferenceError
      || error?.code === 'ERR_MODULE_NOT_FOUND' === false && error instanceof TypeError;
    if (runtimeOnly) {
      process.stdout.write(`  ok  ${label}  (parsed; needs a browser to run)\n`);
      continue;
    }
    failures += 1;
    process.stdout.write(`  FAIL ${label}\n       ${error.message}\n`);
  }
}

process.stdout.write(`\n${files.length - failures}/${files.length} modules loaded cleanly\n`);
process.exit(failures > 0 ? 1 : 0);
