# tsuki Error Codes Reference

All `TsukiError` variants are defined in `src/error.rs`. The format is `T<code>` where the code determines severity and category.

## General / Parse (T0001–T0099)

| Code | Severity | Description | Mode |
|------|----------|-------------|------|
| T0001 | error | Syntax error — unexpected token | Always |
| T0002 | error | Unexpected end of file | Always |
| T0003 | error | Invalid literal | Always |
| T0004 | warning | Unreachable code | Dev+ |
| T0005 | error | Not all code paths return a value | Always |
| T0006 | error | Undefined identifier | Always |
| T0007 | error | Wrong number of arguments | Always |
| T0008 | error | Type mismatch | Always |
| T0009 | warning | Unused import | Dev+ |
| T0010 | error | Duplicate declaration in same scope | Always |
| T0011 | warning | Variable is written but never read | Dev+ |
| T0012 | warning | Variable shadows a declaration 2+ levels up | Dev+ |
| T0013 | error | Variable may be used before assignment | Dev+ |

## Control-flow (T0100–T0199)

| Code | Severity | Description | Mode |
|------|----------|-------------|------|
| T0101 | warning | Infinite loop with no reachable break or return | Dev+ |
| T0102 | warning | Code after return in the same block | Dev+ |

## Type system (T0200–T0299)

| Code | Severity | Description | Mode |
|------|----------|-------------|------|
| T0200 | error | Cannot use value as type | Always |
| T0201 | warning | Implicit numeric truncation | Dev+ |

## Arduino domain (T0300–T0399)

| Code | Severity | Description | Mode |
|------|----------|-------------|------|
| T0300 | warning | Serial used before Serial.Begin() | Dev+ |
| T0301 | warning | analogRead/analogWrite on digital-only pin | Dev+ |
| T0302 | warning | analogWrite on non-PWM pin | Dev+ |
| T0303 | warning | digitalRead/Write without prior pinMode | Dev+ |
| T0304 | warning | delay() inside interrupt handler | Dev+ |

## AVR memory safety (T0400–T0499) — Strict mode + AVR only

| Code | Severity | Description | Mode |
|------|----------|-------------|------|
| T0400 | warning | String concatenation in loop (heap fragmentation) | Strict, AVR |
| T0401 | warning | malloc/new without free/delete | Strict |
| T0402 | warning | Global String variable on AVR | Strict, AVR |
| T0403 | error | Stack array > 64 bytes on AVR | Strict, AVR |

---

## StrictMode levels

| Level | Description |
|-------|-------------|
| `StrictMode::Lax` | Parse errors only |
| `StrictMode::Dev` | All warnings enabled (default for `tsuki check`) |
| `StrictMode::Strict` | Dev + T04xx AVR memory checks |

---

## Adding a new error code

1. Add the variant to `src/error.rs` — include the T-code in the Display string:
   ```rust
   #[error("T0099: my error at {span}: {detail}")]
   MyError { span: Span, detail: String },
   ```
2. Add it to this table in `references/error-codes.md`.
3. Add the `TsukiErrorCode` value to `ide/src/components/experiments/Lsp/_types.ts`.
4. Use the next available code in the appropriate range.

Never assign a T-code that's already in this table.