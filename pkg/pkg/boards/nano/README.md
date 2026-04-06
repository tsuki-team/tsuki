# Arduino Nano

Arduino Nano — AVR ATmega328P, compact DIP form factor

## Installation

```sh
tsuki boards install nano
```

## FQBN

`arduino:avr:nano`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "nano"
}
```

Or set as the default board:

```sh
tsuki config set default_board nano
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
