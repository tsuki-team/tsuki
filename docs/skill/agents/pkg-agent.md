# Agent Guide: tsukilib Package Creation & Maintenance

Use this guide when your task involves:
- Creating a new package under `pkg/`
- Updating an existing package's `godotinolib.toml`
- Adding examples to a package
- Updating `pkg/packages.json`
- Understanding how packages are loaded and used in transpilation

---

## Package structure

```
pkg/<name>/
├── README.md
└── v<semver>/
    ├── godotinolib.toml   ← single source of truth for the API
    └── examples/
        └── <example-name>/
            ├── main.go                ← required
            ├── tsuki_example.json     ← required (example metadata)
            └── circuit.tsuki-circuit  ← optional (sandbox wiring)
```

---

## godotinolib.toml format

```toml
[package]
name        = "mypkg"
version     = "1.0.0"
description = "Brief description of what the library does"
author      = "tsuki-team"
cpp_header  = "MyLib.h"           # Arduino library header to #include
arduino_lib = "MyLib"             # arduino-cli library name for auto-install
cpp_class   = "MyClass"           # Main C++ class name

aliases = ["MyClass", "MyObj"]    # Go type names that map to this C++ class

# ── Constructor ──────────────────────────────────────────────────────────────
[[function]]
go     = "New"
python = "new"
cpp    = "MyClass({0}, {1})"      # {0}, {1} = positional args

# ── Method ───────────────────────────────────────────────────────────────────
[[function]]
go     = "Read"
python = "read"
cpp    = "{self}.read()"          # {self} = receiver variable

# ── Varargs method ───────────────────────────────────────────────────────────
[[function]]
go     = "Write"
python = "write"
cpp    = "{self}.write({args})"   # {args} = all args joined with ", "

# ── Constant ─────────────────────────────────────────────────────────────────
[[constant]]
go     = "MODE_FAST"
python = "MODE_FAST"
cpp    = "MY_LIB_MODE_FAST"
```

### Template token reference

| Token | Expands to |
|-------|-----------|
| `{0}` | First argument |
| `{1}` | Second argument |
| `{2}` | Third argument |
| `{self}` | Receiver variable (method call) |
| `{args}` | All arguments joined with `, ` |

### Rules

- Every `[[function]]` must have `go`, `python`, and `cpp` keys.
- Every `[[constant]]` must have all three name keys.
- `cpp_header` is the `#include` that gets injected — verify it matches the Arduino library exactly.
- `arduino_lib` is used by `lib_manager.rs` to auto-install via arduino-cli. Use the exact library name from the Arduino Library Manager.

---

## tsuki_example.json format

```json
{
  "name": "Basic Usage",
  "description": "Shows how to initialize and read from mypkg",
  "board": "uno",
  "packages": ["mypkg"]
}
```

---

## packages.json registration

```json
{
  "packages": {
    "mypkg": {
      "description": "Brief one-liner",
      "author": "tsuki-team",
      "latest": "1.0.0",
      "versions": {
        "1.0.0": "https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/pkg/mypkg/v1.0.0/godotinolib.toml"
      }
    }
  }
}
```

Always update `packages.json` when creating or releasing a new version.

---

## How packages are loaded at transpile time

1. `tsuki pkg install mypkg` → downloads `godotinolib.toml` to local libs dir.
2. `tsuki build` → passes `--libs-dir <path> --packages mypkg` to `tsuki-core`.
3. `tsuki-core` → `src/runtime/pkg_loader.rs` reads the TOML → registers functions/constants into `Runtime`.
4. During transpilation, Go calls to `mypkg.Read(sensor)` are matched against the runtime and expanded to `sensor.read()`.

**Implication:** changes to `godotinolib.toml` only take effect after the user re-installs the package.

---

## Common patterns

### Sensor with setup + read

```toml
[[function]]
go = "NewDHT"
python = "new_dht"
cpp = "DHT({0}, {1})"        # pin, type

[[function]]
go = "Begin"
python = "begin"
cpp = "{self}.begin()"

[[function]]
go = "ReadTemperature"
python = "read_temperature"
cpp = "{self}.readTemperature()"

[[function]]
go = "ReadHumidity"
python = "read_humidity"
cpp = "{self}.readHumidity()"
```

### LED strip (WS2812 / NeoPixel style)

```toml
[[function]]
go = "NewStrip"
python = "new_strip"
cpp = "Adafruit_NeoPixel({0}, {1}, NEO_GRB + NEO_KHZ800)"  # count, pin

[[function]]
go = "SetPixelColor"
python = "set_pixel_color"
cpp = "{self}.setPixelColor({0}, {self}.Color({1}, {2}, {3}))"  # i, r, g, b

[[function]]
go = "Show"
python = "show"
cpp = "{self}.show()"
```

---

## Checklist before committing a new package

- [ ] `godotinolib.toml` has all required fields (`name`, `version`, `cpp_header`, `arduino_lib`, `cpp_class`)
- [ ] All `[[function]]` entries have `go`, `python`, `cpp`
- [ ] All `[[constant]]` entries have `go`, `python`, `cpp`
- [ ] At least one example exists under `examples/`
- [ ] The example has a `tsuki_example.json`
- [ ] The example's `main.go` compiles without errors
- [ ] `pkg/packages.json` is updated
- [ ] `README.md` documents the public API