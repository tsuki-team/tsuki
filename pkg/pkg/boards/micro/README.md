# Arduino Micro

Arduino Micro — ATmega32U4, native USB, breadboard-friendly

## Installation

```sh
tsuki boards install micro
```

## FQBN

`arduino:avr:micro`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "micro"
}
```

Or set as the default board:

```sh
tsuki config set default_board micro
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
