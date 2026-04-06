# Arduino Mega 2560

Arduino Mega 2560 — AVR ATmega2560, 54 digital I/O, 256K flash

## Installation

```sh
tsuki boards install mega
```

## FQBN

`arduino:avr:mega`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "mega"
}
```

Or set as the default board:

```sh
tsuki config set default_board mega
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
