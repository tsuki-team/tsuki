# NodeMCU 1.0 (ESP-12E)

NodeMCU 1.0 ESP-12E — ESP8266, WiFi, 4MB flash, LuA-style pinout

## Installation

```sh
tsuki boards install nodemcu
```

## FQBN

`esp8266:esp8266:nodemcuv2`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "nodemcu"
}
```

Or set as the default board:

```sh
tsuki config set default_board nodemcu
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
