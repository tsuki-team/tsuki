# Arduino Leonardo

Arduino Leonardo — AVR ATmega32U4, native USB HID support

## Installation

```sh
tsuki boards install leonardo
```

## FQBN

`arduino:avr:leonardo`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "leonardo"
}
```

Or set as the default board:

```sh
tsuki config set default_board leonardo
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
