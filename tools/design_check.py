#!/usr/bin/env python3
"""Checks site source against DESIGN_RULES.md.

Mechanical rules only. Passing this does not mean a page is good, it means the
page does not contain the failures a machine can see. The eye pass in
DESIGN_RULES.md still applies.

Shadows are allowed on genuinely floating elements. Mark those declarations with
a trailing /* overlay */ comment so this checker can tell them apart.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
TOKENS = SITE / "assets" / "tokens.css"

BANNED_WORDS = [
    "unleash", "supercharge", "elevate", "transform", "transforms", "transforming",
    "revolutionise", "revolutionize", "empower", "empowers", "seamless",
    "seamlessly", "effortless", "effortlessly", "cutting-edge", "game-changing",
    "next-level", "unlock", "unlocks", "harness", "robust", "leverage",
    "powerful", "delve", "paradigm", "synergy",
]

# Sparkles, AI shimmer glyphs, emoji, and dingbats pasted in as interface.
GLYPHS = re.compile(
    "["
    "\U0001F300-\U0001FAFF"  # pictographs, transport, supplemental
    "←-⇿"          # arrows
    "☀-➿"          # misc symbols and dingbats, includes sparkles and the hamburger
    "⬀-⯿"          # more arrows and stars
    "️"                 # variation selector
    "]"
)

HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
STYLE_OR_SCRIPT = re.compile(r"<(style|script)\b.*?</\1>", re.I | re.S)
TAG = re.compile(r"<[^>]+>")
COPY_ATTRS = re.compile(
    r'\b(alt|title|aria-label|placeholder|content)\s*=\s*"([^"]*)"', re.I
)

failures = []


def fail(path, line_no, message):
    where = f"{path.relative_to(ROOT)}:{line_no}" if line_no else str(path.relative_to(ROOT))
    failures.append(f"{where}: {message}")


def visible_copy(path, text):
    """Yield (line_no, string) for text a reader actually sees."""
    if path.suffix != ".html":
        return
    stripped = STYLE_OR_SCRIPT.sub(lambda m: "\n" * m.group(0).count("\n"), text)
    for line_no, line in enumerate(stripped.splitlines(), 1):
        for _, value in COPY_ATTRS.findall(line):
            yield line_no, value
        body = TAG.sub(" ", line).strip()
        if body:
            yield line_no, body


def check_copy(path, text):
    for line_no, copy in visible_copy(path, text):
        lowered = copy.lower()
        for word in BANNED_WORDS:
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                fail(path, line_no, f"banned word in copy: {word!r} (rule 4)")
        if "—" in copy:
            fail(path, line_no, "em dash in UI copy, use two sentences or a comma (rule 4)")
        found = GLYPHS.findall(copy)
        if found:
            fail(path, line_no, f"emoji or glyph used as interface: {''.join(found)!r} (rule 3)")


def check_source(path, text):
    lines = text.splitlines()
    for line_no, line in enumerate(lines, 1):
        low = line.lower()

        if "background-clip" in low and "text" in low:
            fail(path, line_no, "gradient text is banned (rule 1)")

        if "gradient(" in low and re.search(
            r"(purple|violet|indigo|fuchsia|#[0-9a-f]*(8b5cf6|6366f1|a855f7|7c3aed))", low
        ):
            fail(path, line_no, "blue to purple / indigo to violet gradient (rule 1)")

        if "box-shadow" in low and "none" not in low and "/* overlay */" not in line:
            fail(path, line_no, "shadow on a non-floating element, or an unmarked overlay (rule 2)")

        for value in re.findall(r"scale\(([0-9.]+)", low):
            if float(value) > 1.02:
                fail(path, line_no, f"scale({value}) above 1.02 on hover (rule 5)")

        for value, unit in re.findall(r"(\d+(?:\.\d+)?)(ms|s)\b", low):
            ms = float(value) * (1000 if unit == "s" else 1)
            if ms > 300:
                fail(path, line_no, f"{value}{unit} duration, cap is 300ms (rule 5)")

        for value in re.findall(r"font-size:\s*(\d+)px", low):
            if int(value) > 56:
                fail(path, line_no, f"font-size {value}px above the 56px ceiling (rule 6)")
            if int(value) < 12:
                fail(path, line_no, f"font-size {value}px below the 12px floor (rule 6)")

        for prop, value in re.findall(r"\b(margin|padding|gap)[a-z-]*:\s*([^;]+)", low):
            for px in re.findall(r"(\d+)px", value):
                if int(px) % 4 != 0:
                    fail(path, line_no, f"{prop} value {px}px is not a multiple of 4 (rule 6)")

        if path != TOKENS:
            for hex_value in HEX.findall(line):
                fail(path, line_no, f"hardcoded colour {hex_value}, use a token (rule 9)")
            if re.search(r"^\s*:root\s*{", line):
                fail(path, line_no, "tokens are redeclared outside tokens.css (rule 0)")

        if path.suffix == ".html":
            for tag in re.findall(r"<img\b[^>]*>", line, re.I):
                if "alt=" not in tag.lower():
                    fail(path, line_no, "image without alt (rule 9)")
            if re.search(r"<div\b[^>]*\bonclick", low):
                fail(path, line_no, "clickable div, use a button or a link (rule 9)")


def main():
    files = sorted(
        p for p in SITE.rglob("*")
        if p.suffix in {".html", ".css", ".js"} and p.is_file()
    )
    if not files:
        print("design-check: no source files found under site/")
        return 1

    corpus = ""
    for path in files:
        text = path.read_text(encoding="utf-8")
        corpus += text
        check_source(path, text)
        check_copy(path, text)

    if ":focus-visible" not in corpus:
        failures.append("site/: no :focus-visible styles anywhere (rule 9)")

    if failures:
        print(f"design-check: {len(failures)} failure(s)\n")
        for item in failures:
            print(f"  {item}")
        print("\nSee DESIGN_RULES.md.")
        return 1

    print(f"design-check: {len(files)} file(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
