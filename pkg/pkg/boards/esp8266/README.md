# ESP8266 Generic

ESP8266 Generic — Xtensa LX106, WiFi, 1MB flash

## Installation

```sh
tsuki boards install esp8266
```

## FQBN

`esp8266:esp8266:generic`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "esp8266"
}
```

Or set as the default board:

```sh
tsuki config set default_board esp8266
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
