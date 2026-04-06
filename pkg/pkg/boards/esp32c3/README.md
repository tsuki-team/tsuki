# ESP32-C3 Dev Module

ESP32-C3 — RISC-V single-core, WiFi, BT 5.0, native USB

## Installation

```sh
tsuki boards install esp32c3
```

## FQBN

`esp32:esp32:esp32c3`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "esp32c3"
}
```

Or set as the default board:

```sh
tsuki config set default_board esp32c3
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
