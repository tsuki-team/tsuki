#!/usr/bin/env python3
"""
tsuki pkg manager
=================
Manages the pkg/ directory and keeps packages.json in sync.

Handles both package types:
  - Libraries  — godotinolib.toml  ([package] section)
  - Boards     — board.toml  OR  tsuki_board.toml  ([board]/[toolchain] sections)

Usage
-----
  python pkg_manager.py list                       # list all packages
  python pkg_manager.py validate                   # validate every package
  python pkg_manager.py sync                       # rebuild packages.json from disk
  python pkg_manager.py new <n> [--version 1.0.0] [--desc "..."] [--lib "Arduino Lib"]
  python pkg_manager.py add-example <pkg> [--version 1.0.0] <example-name>
  python pkg_manager.py bump <pkg> <new-version>   # bump version, scaffold new dir

All commands read/write relative to the script's own directory (pkg/).
"""

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from pathlib import Path
from typing import Optional

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # pip install tomli
    except ImportError:
        tomllib = None  # type: ignore


# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent.resolve()   # <repo>/tools
REPO_ROOT  = SCRIPT_DIR.parent                 # <repo>
PKG_DIR    = REPO_ROOT / 'pkg'                 # <repo>/pkg

GITHUB_RAW_BASE = "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads"

# Manifest filenames recognised as board or lib manifests.
# Checked in order: first match wins.
BOARD_MANIFESTS = ("tsuki_board.toml", "board.toml")   # board
LIB_MANIFEST    = "godotinolib.toml"                    # lib

# pkg/ subdirectories that are never packages — skip them entirely.
_SKIP_DIRS = {"keys", "boards", "pkg"}
_VERSION_RE = re.compile(r'^v\d+\.\d+')   # e.g. "v1.0.0" at top level


def _check_pkg_dir() -> None:
    if not PKG_DIR.exists():
        print(f"[error] pkg/ directory not found at: {PKG_DIR}", file=sys.stderr)
        sys.exit(1)


def _detect_branch() -> str:
    if env := os.environ.get("TSUKI_BRANCH", "").strip():
        return env
    try:
        import subprocess as _sp
        result = _sp.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=5,
        )
        branch = result.stdout.strip()
        if result.returncode == 0 and branch and branch != "HEAD":
            return branch
    except Exception:
        pass
    return "main"


def _registry_url(branch: str | None = None) -> str:
    b = branch or _detect_branch()
    return f"{GITHUB_RAW_BASE}/{b}/pkg"


# ── TOML helpers ──────────────────────────────────────────────────────────────

def read_toml(path: Path) -> dict:
    """Parse a TOML manifest and return a flat dict.

    Flattens *both* the ``[package]`` section (godotinolib.toml) and the
    ``[board]`` section (board.toml / tsuki_board.toml) to the top level so
    callers can use ``data['description']`` regardless of manifest type.
    """
    if tomllib is None:
        # Regex fallback: read [package] or [board] section
        text = path.read_text(encoding='utf-8')
        result: dict = {}
        current_section: str | None = None
        for line in text.splitlines():
            m_sec = re.match(r'^\[(\w+)\]', line)
            if m_sec:
                current_section = m_sec.group(1)
                continue
            m_kv = re.match(r'(\w+)\s*=\s*"([^"]*)"', line)
            if m_kv and current_section in ('package', 'board', None):
                result[m_kv.group(1)] = m_kv.group(2)
        return result

    with open(path, 'rb') as f:
        raw = tomllib.load(f)

    # Hoist [package] fields (godotinolib.toml)
    if 'package' in raw and isinstance(raw['package'], dict):
        flat = dict(raw['package'])
        for k, v in raw.items():
            if k != 'package':
                flat[k] = v
        return flat

    # Hoist [board] fields (board.toml / tsuki_board.toml)
    if 'board' in raw and isinstance(raw['board'], dict):
        flat = dict(raw['board'])
        for k, v in raw.items():
            if k != 'board':
                flat[k] = v
        return flat

    return raw


def _pkg_type_for(ver_dir: Path) -> tuple[str, Path] | None:
    """Return (type, manifest_path) for the version directory, or None."""
    # Board manifests take priority
    for name in BOARD_MANIFESTS:
        p = ver_dir / name
        if p.exists():
            return 'board', p
    # Lib manifest
    p = ver_dir / LIB_MANIFEST
    if p.exists():
        return 'lib', p
    return None


def _arch_from_data(data: dict) -> str:
    """Extract architecture from either board.toml or tsuki_board.toml format.

    board.toml        → [board] toolchain_type = "avr"   (flattened to top)
    tsuki_board.toml  → [toolchain] type = "esp32"       (nested under 'toolchain')
    """
    # Flattened board.toml field
    if arch := data.get('toolchain_type', ''):
        return arch
    # Nested tsuki_board.toml field
    if isinstance(data.get('toolchain'), dict):
        return data['toolchain'].get('type', '')
    # Direct 'type' at top level (some formats)
    return data.get('type', '')


# ── Package discovery ─────────────────────────────────────────────────────────

def iter_packages():
    """Yield (id, version, manifest_path, pkg_type) for every package on disk."""
    if not PKG_DIR.exists():
        return
    for pkg_dir in sorted(PKG_DIR.iterdir()):
        if not pkg_dir.is_dir():
            continue
        name = pkg_dir.name
        # Skip non-package directories
        if name.startswith('.') or name in _SKIP_DIRS or _VERSION_RE.match(name):
            continue
        for ver_dir in sorted(pkg_dir.iterdir()):
            if not ver_dir.is_dir():
                continue
            result = _pkg_type_for(ver_dir)
            if result is not None:
                pkg_type, manifest_path = result
                yield name, ver_dir.name, manifest_path, pkg_type


def latest_version(pkg_name: str) -> Optional[tuple]:
    versions = [
        (ver, p) for n, ver, p, _ in iter_packages() if n == pkg_name
    ]
    return sorted(versions)[-1] if versions else None


# ── Registry builder ──────────────────────────────────────────────────────────

def build_registry(branch: str | None = None) -> dict:
    registry_url = _registry_url(branch)
    registry: dict = {
        "packages": {},
        "branch":   branch or _detect_branch(),
    }

    # Group all versions by package id
    all_versions: dict = {}   # id → {ver: (manifest_path, pkg_type)}
    for name, ver, manifest_path, pkg_type in iter_packages():
        all_versions.setdefault(name, {})[ver] = (manifest_path, pkg_type)

    for pkg_name, versions in sorted(all_versions.items()):
        latest_ver              = sorted(versions.keys())[-1]
        latest_path, pkg_type   = versions[latest_ver]
        data                    = read_toml(latest_path)

        clean_ver   = latest_ver.lstrip('v')
        description = data.get('description', f'{pkg_name} package')
        author      = data.get('author', 'tsuki-team')

        if pkg_type == 'lib':
            arduino_lib = data.get('arduino_lib', '')
            arch        = data.get('arch', '')
            category    = data.get('category', 'sensor')

            version_urls = {}
            for ver, (path_, _) in versions.items():
                clean = ver.lstrip('v')
                version_urls[clean] = f"{registry_url}/{pkg_name}/{ver}/{LIB_MANIFEST}"

            registry['packages'][pkg_name] = {
                'type':        'lib',
                'description': description,
                'author':      author,
                'arduino_lib': arduino_lib,
                'arch':        arch,
                'category':    category,
                'latest':      clean_ver,
                'versions':    version_urls,
            }

        else:  # board
            arch     = _arch_from_data(data)
            category = 'wifi' if arch in ('esp32', 'esp8266') else 'basic'

            # Determine manifest filename used in the version dirs
            # (use whatever name was found for the latest version)
            manifest_name = latest_path.name

            version_urls = {}
            for ver, (path_, _) in versions.items():
                clean = ver.lstrip('v')
                # Use the actual manifest filename found for that specific version
                ver_manifest = _pkg_type_for(path_.parent)
                fname = ver_manifest[1].name if ver_manifest else manifest_name
                version_urls[clean] = f"{registry_url}/{pkg_name}/{ver}/{fname}"

            registry['packages'][pkg_name] = {
                'type':        'board',
                'description': description,
                'author':      author,
                'arch':        arch,
                'category':    category,
                'latest':      clean_ver,
                'versions':    version_urls,
            }

    return registry


# ── Validation ────────────────────────────────────────────────────────────────

REQUIRED_LIB_FIELDS   = ['name', 'version', 'description', 'author']
REQUIRED_LIB_FILES    = ['README.md']
REQUIRED_BOARD_FIELDS = ['id', 'name', 'version', 'description']
REQUIRED_BOARD_FILES  = ['README.md']


def validate_package(pkg_name: str, ver: str, manifest_path: Path, pkg_type: str) -> list[str]:
    errors = []
    ver_dir = manifest_path.parent

    try:
        data = read_toml(manifest_path)
    except Exception as e:
        return [f"Cannot parse TOML: {e}"]

    req_fields = REQUIRED_LIB_FIELDS if pkg_type == 'lib' else REQUIRED_BOARD_FIELDS
    req_files  = REQUIRED_LIB_FILES  if pkg_type == 'lib' else REQUIRED_BOARD_FILES

    for field in req_fields:
        if not data.get(field):
            errors.append(f"Missing/empty field: '{field}'")

    for fname in req_files:
        if not (ver_dir / fname).exists():
            errors.append(f"Missing file: {fname}")

    return errors


# ── Scaffolding ───────────────────────────────────────────────────────────────

LIB_TOML_TEMPLATE = """\
[package]
name        = "{name}"
version     = "{version}"
description = "{description}"
author      = "tsuki-team"
cpp_header  = ""         # C++ header to include, e.g. "DHT.h"
arduino_lib = "{lib}"    # Arduino library name as it appears in library manager
cpp_class   = ""         # Main C++ class name, if any

# ── Functions ─────────────────────────────────────────────────────────────────
# [[function]]
# go     = "New"
# python = "new"
# cpp    = "MyClass({0}, {1})"

# ── Constants ─────────────────────────────────────────────────────────────────
# [[constant]]
# go     = "MY_CONST"
# python = "MY_CONST"
# cpp    = "MY_CONST"

# ── Examples ──────────────────────────────────────────────────────────────────
# [[example]]
# dir = "examples/basic"
"""

LIB_README_TEMPLATE = """\
# {name}

{description}

## Install

```
tsuki pkg install {name}
```

## Usage (Go)

```go
package main

import (
    "arduino"
    "{name}"
)

func setup() {{
}}

func loop() {{
}}
```

## Usage (Python)

```python
import arduino
import {name}
```
"""

LIB_EXAMPLE_TEMPLATE = """\
package main

import (
    "arduino"
    "{name}"
)

func setup() {{
    arduino.SerialBegin(9600)
}}

func loop() {{
}}
"""

LIB_CIRCUIT_TEMPLATE = '{"version":1,"components":[],"wires":[]}'
LIB_TSUKI_EXAMPLE_TEMPLATE = """\
{{
  "name": "{name} basic example",
  "description": "Basic usage of the {name} package.",
  "board": "uno",
  "packages": ["{name}"]
}}
"""


def scaffold_new(name: str, version: str, description: str, lib: str):
    ver_str = f'v{version}'
    ver_dir = PKG_DIR / name / ver_str

    if ver_dir.exists():
        print(f'[error] {ver_dir} already exists')
        sys.exit(1)

    ver_dir.mkdir(parents=True)
    ex_dir = ver_dir / 'examples' / 'basic'
    ex_dir.mkdir(parents=True)

    (ver_dir / 'godotinolib.toml').write_text(LIB_TOML_TEMPLATE.format(
        name=name, version=version, description=description, lib=lib,
    ), encoding='utf-8')
    (ver_dir / 'README.md').write_text(LIB_README_TEMPLATE.format(
        name=name, description=description,
    ), encoding='utf-8')
    (ex_dir / 'main.go').write_text(LIB_EXAMPLE_TEMPLATE.format(name=name), encoding='utf-8')
    (ex_dir / 'circuit.tsuki-circuit').write_text(LIB_CIRCUIT_TEMPLATE, encoding='utf-8')
    (ex_dir / 'tsuki_example.json').write_text(LIB_TSUKI_EXAMPLE_TEMPLATE.format(name=name), encoding='utf-8')

    print(f'[ok] Scaffolded pkg/{name}/{ver_str}/')
    print(f'     Edit godotinolib.toml — fill in cpp_header, arduino_lib, functions, constants.')
    print(f'     Then run: python pkg_manager.py sync')


def scaffold_example(pkg_name: str, version: str, example_name: str):
    ver_str  = f'v{version}'
    ex_dir   = PKG_DIR / pkg_name / ver_str / 'examples' / example_name

    if not (PKG_DIR / pkg_name / ver_str / 'godotinolib.toml').exists():
        print(f'[error] Package {pkg_name}/{ver_str} does not exist')
        sys.exit(1)
    if ex_dir.exists():
        print(f'[error] Example {example_name} already exists in {pkg_name}/{ver_str}')
        sys.exit(1)

    ex_dir.mkdir(parents=True)
    (ex_dir / 'main.go').write_text(LIB_EXAMPLE_TEMPLATE.format(name=pkg_name), encoding='utf-8')
    (ex_dir / 'circuit.tsuki-circuit').write_text(LIB_CIRCUIT_TEMPLATE, encoding='utf-8')
    (ex_dir / 'tsuki_example.json').write_text(
        LIB_TSUKI_EXAMPLE_TEMPLATE.format(name=pkg_name), encoding='utf-8',
    )
    print(f'[ok] Scaffolded example pkg/{pkg_name}/{ver_str}/examples/{example_name}/')
    print(f'     Edit main.go and circuit.tsuki-circuit, then add [[example]] to godotinolib.toml.')


def bump_version(pkg_name: str, new_version: str):
    latest = latest_version(pkg_name)
    if not latest:
        print(f'[error] Package {pkg_name!r} not found in pkg/')
        sys.exit(1)

    old_ver, old_manifest = latest
    old_dir = old_manifest.parent
    new_ver = f'v{new_version}'
    new_dir = PKG_DIR / pkg_name / new_ver

    if new_dir.exists():
        print(f'[error] {new_dir} already exists')
        sys.exit(1)

    shutil.copytree(old_dir, new_dir)

    # Update version in whichever manifest is present
    for manifest_name in (LIB_MANIFEST, *BOARD_MANIFESTS):
        p = new_dir / manifest_name
        if p.exists():
            text = p.read_text(encoding='utf-8')
            text = re.sub(
                r'^version\s*=\s*"[^"]*"',
                f'version     = "{new_version}"',
                text, flags=re.MULTILINE,
            )
            p.write_text(text, encoding='utf-8')
            break

    print(f'[ok] Bumped {pkg_name}: {old_ver} → {new_ver}')
    print(f'     Edit pkg/{pkg_name}/{new_ver}/ as needed, then run: python pkg_manager.py sync')


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_list(_args):
    _check_pkg_dir()
    rows = []
    for name, ver, manifest_path, pkg_type in iter_packages():
        try:
            data = read_toml(manifest_path)
            desc = data.get('description', '')[:55]
            arch = _arch_from_data(data) if pkg_type == 'board' else data.get('arduino_lib', '')[:15]
        except Exception:
            desc, arch = '(parse error)', '?'
        rows.append((name, ver, pkg_type, arch, desc))

    if not rows:
        print('No packages found in', PKG_DIR)
        return

    c1 = max(len(r[0]) for r in rows) + 2
    c2 = max(len(r[1]) for r in rows) + 2
    c3 = 7
    c4 = 18
    print(f"{'NAME':<{c1}} {'VERSION':<{c2}} {'TYPE':<{c3}} {'ARCH / LIB':<{c4}} DESCRIPTION")
    print('─' * 100)
    for name, ver, pkg_type, arch, desc in rows:
        print(f'{name:<{c1}} {ver:<{c2}} {pkg_type:<{c3}} {arch:<{c4}} {desc}')


def cmd_validate(_args):
    _check_pkg_dir()
    found_errors = False
    for name, ver, manifest_path, pkg_type in iter_packages():
        errors = validate_package(name, ver, manifest_path, pkg_type)
        label = f'{name}/{ver} ({pkg_type})'
        if errors:
            found_errors = True
            print(f'[FAIL] {label}')
            for e in errors:
                print(f'       • {e}')
        else:
            print(f'[ OK ] {label}')
    if found_errors:
        sys.exit(1)


def cmd_sync(args):
    _check_pkg_dir()
    branch   = getattr(args, 'branch', None) or None
    resolved = branch or _detect_branch()
    registry = build_registry(branch=resolved)
    out_path = PKG_DIR / 'packages.json'

    n_lib   = sum(1 for e in registry['packages'].values() if e.get('type') == 'lib')
    n_board = sum(1 for e in registry['packages'].values() if e.get('type') == 'board')

    out_path.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'[ok] Wrote packages.json — {n_lib} lib(s), {n_board} board(s) — branch: {resolved}')


def cmd_new(args):
    scaffold_new(
        name=args.name,
        version=args.version,
        description=args.desc or f'{args.name} Arduino library wrapper',
        lib=args.lib or '',
    )
    cmd_sync(args)


def cmd_add_example(args):
    scaffold_example(args.pkg, args.version, args.example_name)


def cmd_bump(args):
    bump_version(args.pkg, args.new_version)
    cmd_sync(args)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='tsuki pkg manager — library and board packages',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python pkg_manager.py list
              python pkg_manager.py validate
              python pkg_manager.py sync
              python pkg_manager.py sync --branch v6.0-dev
              python pkg_manager.py new mylib --desc "My sensor wrapper" --lib "MySensor"
              python pkg_manager.py add-example dht basic2
              python pkg_manager.py bump dht 1.1.0
        """),
    )
    sub = parser.add_subparsers(dest='cmd', required=True)

    branch_flag = argparse.ArgumentParser(add_help=False)
    branch_flag.add_argument('--branch', default='', metavar='BRANCH')

    sub.add_parser('list',     help='List all packages')
    sub.add_parser('validate', help='Validate package structure')
    sub.add_parser('sync',     help='Rebuild packages.json from disk', parents=[branch_flag])

    p_new = sub.add_parser('new', help='Scaffold a new library package', parents=[branch_flag])
    p_new.add_argument('name')
    p_new.add_argument('--version', default='1.0.0')
    p_new.add_argument('--desc',    default='')
    p_new.add_argument('--lib',     default='', metavar='ARDUINO_LIB',
                       help='Arduino library name (as in library manager)')

    p_ex = sub.add_parser('add-example', help='Add an example to an existing package')
    p_ex.add_argument('pkg')
    p_ex.add_argument('example_name')
    p_ex.add_argument('--version', default='1.0.0')

    p_bump = sub.add_parser('bump', help='Bump package version')
    p_bump.add_argument('pkg')
    p_bump.add_argument('new_version')

    args = parser.parse_args()
    dispatch = {
        'list':        cmd_list,
        'validate':    cmd_validate,
        'sync':        cmd_sync,
        'new':         cmd_new,
        'add-example': cmd_add_example,
        'bump':        cmd_bump,
    }
    dispatch[args.cmd](args)


if __name__ == '__main__':
    main()