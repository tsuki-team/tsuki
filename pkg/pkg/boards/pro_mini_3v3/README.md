# Arduino Pro Mini 3.3V

Arduino Pro Mini 3.3V/8MHz — ATmega328P, low-power, no USB

## Installation

```sh
tsuki boards install pro_mini_3v3
```

## FQBN

`arduino:avr:pro:cpu=8MHzatmega328`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "pro_mini_3v3"
}
```

Or set as the default board:

```sh
tsuki config set default_board pro_mini_3v3
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
