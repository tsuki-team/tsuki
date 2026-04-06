# Wemos D1 Mini

Wemos D1 Mini — ESP8266, WiFi, 4MB flash, compact form factor

## Installation

```sh
tsuki boards install d1_mini
```

## FQBN

`esp8266:esp8266:d1_mini`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "d1_mini"
}
```

Or set as the default board:

```sh
tsuki config set default_board d1_mini
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
