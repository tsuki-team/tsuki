# ESP32 Dev Module

ESP32 Dev Module — Xtensa LX6 dual-core, WiFi, BT, 4MB flash

## Installation

```sh
tsuki boards install esp32
```

## FQBN

`esp32:esp32:esp32`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "esp32"
}
```

Or set as the default board:

```sh
tsuki config set default_board esp32
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
