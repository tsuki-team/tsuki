#!/usr/bin/env python3
"""
scripts/check-invariants.py
Validate tsuki repository invariants before committing.

Checks:
  1. All TsukiError variants carry a Span field
  2. All packages under pkg/ have at least one Go example
  3. All packages under pkg/ are registered in pkg/packages.json
  4. All board platforms under boards/ are registered in boards/boards.json
  5. Transpiler output contains no randomness markers (time.now, rand, uuid)
  6. No hardcoded hex colors in IDE TypeScript/TSX files

Usage:
  python3 scripts/check-invariants.py [--root <repo-root>]
"""

import sys
import os
import re
import json
import argparse
from pathlib import Path


def find_root(start: Path) -> Path:
    """Walk up to find repo root (contains Cargo.toml at root level)."""
    p = start
    for _ in range(10):
        if (p / "Cargo.toml").exists() and (p / "cli").exists():
            return p
        p = p.parent
    return start


def check_error_spans(root: Path) -> list[str]:
    """Verify all TsukiError variants include a span field."""
    errors = []
    error_rs = root / "src" / "error.rs"
    if not error_rs.exists():
        return [f"Missing {error_rs}"]

    text = error_rs.read_text(encoding="utf-8")
    # Find enum TsukiError block
    in_enum = False
    variant_lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if "enum TsukiError" in stripped:
            in_enum = True
            continue
        if in_enum:
            if stripped == "}":
                break
            if stripped.startswith("//") or not stripped:
                continue
            variant_lines.append(stripped)

    for line in variant_lines:
        # Skip unit variants and tuple variants that clearly have span
        if "{" in line and "span" not in line.lower() and "Span" not in line:
            # Allow variants that are known to be span-less (e.g. Other(String))
            if "Other" in line or "Io" in line or "Http" in line:
                continue
            errors.append(f"  TsukiError variant may be missing span: {line[:80]}")

    return errors


def check_package_examples(root: Path) -> list[str]:
    """Every package under pkg/ must have at least one Go example."""
    errors = []
    pkg_dir = root / "pkg"
    if not pkg_dir.exists():
        return []

    for pkg_path in sorted(pkg_dir.iterdir()):
        if not pkg_path.is_dir() or pkg_path.name.startswith("."):
            continue
        pkg_name = pkg_path.name
        # Find any version directory
        versions = [v for v in pkg_path.iterdir() if v.is_dir() and v.name.startswith("v")]
        if not versions:
            errors.append(f"  pkg/{pkg_name}: no version directory found")
            continue
        latest = sorted(versions)[-1]
        examples_dir = latest / "examples"
        go_files = list(examples_dir.rglob("*.go")) if examples_dir.exists() else []
        if not go_files:
            errors.append(f"  pkg/{pkg_name}/{latest.name}/: no Go example found (required by invariant #6)")

    return errors


def check_packages_json(root: Path) -> list[str]:
    """All packages on disk must be registered in pkg/packages.json."""
    errors = []
    packages_json = root / "pkg" / "packages.json"
    if not packages_json.exists():
        return [f"  Missing pkg/packages.json"]

    try:
        index = json.loads(packages_json.read_text(encoding="utf-8"))
        registered = set(index.get("packages", {}).keys())
    except json.JSONDecodeError as e:
        return [f"  pkg/packages.json is invalid JSON: {e}"]

    pkg_dir = root / "pkg"
    for pkg_path in sorted(pkg_dir.iterdir()):
        if not pkg_path.is_dir() or pkg_path.name.startswith(".") or pkg_path.name == "keys":
            continue
        if pkg_path.name not in registered:
            errors.append(f"  pkg/{pkg_path.name}: not registered in pkg/packages.json")

    return errors


def check_boards_json(root: Path) -> list[str]:
    """All board platform directories must be registered in boards/boards.json."""
    errors = []
    boards_dir = root / "boards"
    boards_json = boards_dir / "boards.json"
    if not boards_dir.exists():
        return []  # boards/ may not exist yet
    if not boards_json.exists():
        return [f"  Missing boards/boards.json"]

    try:
        index = json.loads(boards_json.read_text(encoding="utf-8"))
        registered = set(index.get("boards", {}).keys())
    except json.JSONDecodeError as e:
        return [f"  boards/boards.json is invalid JSON: {e}"]

    for board_path in sorted(boards_dir.iterdir()):
        if not board_path.is_dir() or board_path.name.startswith("."):
            continue
        if board_path.name not in registered:
            errors.append(f"  boards/{board_path.name}: not registered in boards/boards.json")

    return errors


def check_transpiler_determinism(root: Path) -> list[str]:
    """Transpiler source must not use randomness or timestamps."""
    errors = []
    bad_patterns = [
        (re.compile(r"\bSystemTime::now\(\)"), "SystemTime::now()"),
        (re.compile(r"\bInstant::now\(\)"), "Instant::now()"),
        (re.compile(r"\brand::"), "rand::"),
        (re.compile(r"\bUuid::new"), "Uuid::new"),
        (re.compile(r"\bthread_rng\(\)"), "thread_rng()"),
    ]

    transpiler_dirs = [
        root / "src" / "transpiler",
        root / "src" / "lexer",
        root / "src" / "parser",
        root / "src" / "runtime",
        root / "src" / "python",
    ]

    for d in transpiler_dirs:
        if not d.exists():
            continue
        for rs_file in d.rglob("*.rs"):
            text = rs_file.read_text(encoding="utf-8")
            for pattern, label in bad_patterns:
                if pattern.search(text):
                    rel = rs_file.relative_to(root)
                    errors.append(f"  {rel}: found non-deterministic call: {label}")

    return errors


def check_no_hardcoded_colors(root: Path) -> list[str]:
    """IDE TypeScript/TSX files must not contain hardcoded hex color values."""
    errors = []
    ide_src = root / "ide" / "src"
    if not ide_src.exists():
        return []

    # Hex color pattern: #rrggbb or #rgb NOT inside a comment or CSS var
    hex_color = re.compile(r'(?<!var\()(?<![\w-])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])')
    # Allow known design-system values that appear in globals.css definitions
    allowed_hex = {
        "0a0a0a", "111111", "171717", "1f1f1f", "282828",
        "ededed", "8c8c8c", "484848", "242424", "1c1c1c",
        "22c55e", "ef4444", "f59e0b", "93c5fd",
        "d4d4d4", "a0a0a0", "b0b0b0", "525252", "c8c8c8",
    }

    for ts_file in ide_src.rglob("*.tsx"):
        text = ts_file.read_text(encoding="utf-8")
        for line_no, line in enumerate(text.splitlines(), 1):
            # Skip comment lines
            if line.strip().startswith("//"):
                continue
            for m in hex_color.finditer(line):
                val = m.group(1).lower()
                if len(val) == 3:
                    val = val[0]*2 + val[1]*2 + val[2]*2
                if val not in allowed_hex:
                    rel = ts_file.relative_to(root)
                    errors.append(f"  {rel}:{line_no}: hardcoded color #{val} — use var(--token)")
                    break  # one per line is enough

    return errors


def main():
    parser = argparse.ArgumentParser(description="Check tsuki repository invariants")
    parser.add_argument("--root", help="Repository root (auto-detected if not set)")
    args = parser.parse_args()

    root = Path(args.root) if args.root else find_root(Path.cwd())
    print(f"Checking invariants in: {root}\n")

    all_errors = []
    checks = [
        ("Span fields in TsukiError", check_error_spans),
        ("Go examples in packages", check_package_examples),
        ("packages.json registration", check_packages_json),
        ("boards.json registration", check_boards_json),
        ("Transpiler determinism", check_transpiler_determinism),
        ("No hardcoded colors in IDE", check_no_hardcoded_colors),
    ]

    for name, fn in checks:
        errs = fn(root)
        if errs:
            print(f"✗ {name}")
            for e in errs:
                print(e)
            all_errors.extend(errs)
        else:
            print(f"✔ {name}")

    print()
    if all_errors:
        print(f"FAILED: {len(all_errors)} invariant violation(s)")
        sys.exit(1)
    else:
        print("All invariants passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()