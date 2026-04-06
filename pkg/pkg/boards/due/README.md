# Arduino Due

Arduino Due — ARM Cortex-M3 AT91SAM3X8E, 84MHz, 512K flash

## Installation

```sh
tsuki boards install due
```

## FQBN

`arduino:sam:arduino_due_x`

## Usage

Set as project board in `tsuki_package.json`:

```json
{
  "board": "due"
}
```

Or set as the default board:

```sh
tsuki config set default_board due
```

## Manifest

See `v1.0.0/tsuki_board.toml` for the full board definition.
