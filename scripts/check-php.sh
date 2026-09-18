#!/usr/bin/env bash
# Lints every PHP file shipped to the WordPress theme.
set -euo pipefail

if ! command -v php >/dev/null 2>&1; then
  echo "php not installed — skipping PHP lint"
  exit 0
fi

failures=0
while IFS= read -r -d '' file; do
  if php -l "$file" > /dev/null 2>&1; then
    echo "  ok  $file"
  else
    echo "  FAIL $file"
    php -l "$file" || true
    failures=$((failures + 1))
  fi
done < <(find theme -name '*.php' -print0)

if [ "$failures" -gt 0 ]; then
  echo "$failures PHP file(s) failed to parse"
  exit 1
fi
echo "all PHP files parse cleanly"
