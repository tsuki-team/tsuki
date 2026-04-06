# Arduino Nano (old bootloader)

Arduino Nano with old optiboot bootloader — baud 57600

## Installation

```sh
tsuki boards install nano_old
```

## FQBN

`arduino:avr:nano:cpu=atmega328old`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "nano_old"
}
```

Or set as the default board:

```sh
tsuki config set default_board nano_old
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
