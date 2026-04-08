# Agent Guide: tsuki IDE (Next.js + Tauri)

Use this guide when your task involves:
- `ide/src/components/` — React components
- `ide/src/lib/store.ts` — Zustand store (global state)
- `ide/src/lib/tauri.ts` — Tauri IPC bridge
- `ide/src-tauri/` — Tauri Rust backend
- Styling, layout, design tokens

---

## Architecture

```
Next.js (React, TypeScript, Tailwind)
    ↕ Tauri IPC (invoke / listen)
Rust Tauri backend
    ↕ subprocess / sidecar
tsuki-core binary  +  tsuki-flash binary
```

All calls to `tsuki-core` and `tsuki-flash` go through the Tauri backend. Never call binaries directly from JS.

---

## Zustand store (ide/src/lib/store.ts)

The global store holds all IDE state. Key slices:

| Slice | Type | Purpose |
|-------|------|---------|
| `files` | `TsukiFile[]` | Open editor files |
| `activeFile` | `string \| null` | Currently focused file |
| `board` | `string` | Selected board ID |
| `packages` | `PackageEntry[]` | Installed tsukilib packages |
| `platforms` | `BoardPlatform[]` | Board platform registry state |
| `sidebarTab` | `SidebarTab` | Active sidebar tab |
| `settings` | `SettingsState` | All user settings |

**`SidebarTab` type:**
```typescript
export type SidebarTab = 'files' | 'git' | 'packages' | 'examples' | 'platforms' | 'explorer'
```

**`BoardPlatform` interface:**
```typescript
export interface BoardPlatform {
  id:          string
  name:        string
  version:     string
  description: string
  author:      string
  arch:        string          // "avr" | "esp32" | "esp8266" | "rp2040" | "sam"
  category:    string
  installed:   boolean
  installing?: boolean
  url?:        string          // tsukiboard.toml URL in registry
}
```

**Settings fields that affect tooling:**

| Field | Purpose |
|-------|---------|
| `tsukiPath` | Path to `tsuki` binary |
| `registryUrl` | tsukilib package registry |
| `boardsRegistryUrl` | Board platform registry (boards.json) |

---

## Adding a new sidebar tab

1. **Add the tab ID** to `SidebarTab` in `store.ts`.
2. **Create the component** in `ide/src/components/other/<Name>Sidebar.tsx`.
3. **Add the tab entry** to `sidebarTabs` array in `IdeScreen.tsx`.
4. **Add the render case** in the sidebar switch in `IdeScreen.tsx`.
5. **Add any new state** to the store interface + implementation.

Example pattern from `PlatformsSidebar`:
```tsx
// IdeScreen.tsx - sidebarTabs array
{ id: 'platforms', icon: <Cpu size={15} />, label: 'Platforms' },

// IdeScreen.tsx - sidebar switch
case 'platforms': return <PlatformsSidebar />
```

---

## Design system — IDE rules

Full reference: `references/design-system.md`. Critical rules for IDE components:

```tsx
// ✅ Correct — always use CSS variables
className="text-[var(--fg-muted)] bg-[var(--surface-2)]"
className="border border-[var(--border)] rounded"

// ❌ Never — no Tailwind color classes
className="text-gray-400 bg-zinc-900"

// Surface hierarchy (top → bottom):
// body → var(--surface)
// sidebar / nav → var(--surface-1)
// cards / modals → var(--surface-2)
// inputs / dropdowns → var(--surface-3)
// toggles / chips → var(--surface-4)
```

**Borders:** `border border-[var(--border)]` only. No box shadows between panels.

**Radii:** max `rounded` (8px) on cards, `rounded` (4–6px) on controls.

**Text sizes in IDE components:** use `text-[11px]` for body, `text-[10px]` for labels, `text-[9px]` for micro-labels. Never `text-xs` (12px is too large for sidebar density).

**Animations:** 150–200 ms ease. Max 300 ms. Use `transition-colors` for hover states.

---

## Tauri IPC bridge (ide/src/lib/tauri.ts)

```typescript
// Invoke a Tauri command (returns Promise)
import { invoke } from '@tauri-apps/api/core'
const result = await invoke<string>('run_checker', { filePath, board })

// Spawn a long-running process with streaming output
import { spawnProcess } from '@/lib/tauri'
spawnProcess(
  binaryPath,
  ['platforms', 'install', 'esp32'],
  (line: string) => { /* streaming output */ },
  (exitCode: number) => { /* done */ }
)

// Listen to Tauri events
import { listen } from '@tauri-apps/api/event'
await listen<string>('compile-output', (event) => { ... })
```

---

## Component conventions

**File location:** `ide/src/components/other/` for sidebar panels and modals, `ide/src/components/screens/` for full screens.

**Naming:** PascalCase component files, default export only.

**State:** prefer local `useState` for UI-only state (loading spinners, tab selection), Zustand store for anything shared or persisted.

**Tauri calls:** always handle errors (try/catch), always show user feedback (loading state, error message).

**Imports:** use `@/` alias for all internal imports (`@/lib/store`, `@/components/...`).

---

## Build & dev

```bash
cd ide

# Dev server (web only, no Tauri)
npm run dev

# Type-check
npm run type-check

# Tauri dev (requires Rust toolchain)
npm run tauri dev

# Production build
npm run build
npm run tauri build
```

Fix all TypeScript errors before committing. The build must succeed with zero `tsc` errors.

---

## Checker integration (IDE side)

The IDE talks to the Rust checker via two modes:

- **Hybrid mode** (on keystroke, 600 ms debounce): calls `run_checker` Tauri command with `incremental: true`. Budget: < 40 ms.
- **Full mode** (on save / explicit): calls `run_checker` with `incremental: false`. Budget: < 120 ms.

Diagnostics come back as `TsukiDiagnostic[]` and are fed to the LSP engine in `experiments/Lsp/`. New T-codes from checker-v2 must be added to `experiments/Lsp/_types.ts`.