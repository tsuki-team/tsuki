# ESP32-S2 Dev Module

ESP32-S2 — single-core Xtensa LX7, native USB, WiFi

## Installation

```sh
tsuki boards install esp32s2
```

## FQBN

`esp32:esp32:esp32s2`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "esp32s2"
}
```

Or set as the default board:

```sh
tsuki config set default_board esp32s2
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
