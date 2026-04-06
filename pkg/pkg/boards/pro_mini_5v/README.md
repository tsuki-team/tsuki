# Arduino Pro Mini 5V

Arduino Pro Mini 5V/16MHz — ATmega328P, no USB, requires FTDI

## Installation

```sh
tsuki boards install pro_mini_5v
```

## FQBN

`arduino:avr:pro:cpu=16MHzatmega328`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "pro_mini_5v"
}
```

Or set as the default board:

```sh
tsuki config set default_board pro_mini_5v
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
