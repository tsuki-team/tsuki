'use client'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { PlugZap, X, Radio, AlertTriangle } from 'lucide-react'
import { spawnProcess, isTauri } from '@/lib/tauri'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortSelectResult {
  port:   string
  cancel: false
}
export interface PortSelectCancel {
  cancel: true
}
export type PortSelectOutcome = PortSelectResult | PortSelectCancel

interface Props {
  /** Called when the user confirms or cancels */
  onResult: (outcome: PortSelectOutcome) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPortStr(s: string): boolean {
  const t = s.trim()
  return t.startsWith('COM') ||
         t.startsWith('/dev/tty') ||
         t.startsWith('/dev/cu.')
}

function stripDecoration(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^[\s●✔✖▶…·─╭╰│]+/, '')
    .trim()
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortSelectModal({ onResult }: Props) {
  const { settings } = useStore()

  const tsukiFlashBin = (settings.tsukiFlashPath?.trim() || 'tsuki-flash').replace(/^"|"$/g, '')
  const tsukiPath     = (settings.tsukiPath?.trim()      || 'tsuki').replace(/^"|"$/g, '')

  const [ports,    setPorts   ] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [scanning, setScanning ] = useState(true)
  const [error,    setError   ] = useState('')
  const [manual,   setManual  ] = useState('')

  const cancelledRef = useRef(false)

  // ── Port scan ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) {
      setScanning(false)
      setError('Port detection is only available in the desktop app.')
      return
    }

    ;(async () => {
      const found: string[] = []

      // Primary: tsuki-flash detect
      try {
        const h = await spawnProcess(tsukiFlashBin, ['detect'], undefined, (line) => {
          const p = line.trim()
          if (isPortStr(p)) found.push(p)
        })
        await h.done
        h.dispose()
      } catch { /* fall through */ }

      // Fallback: tsuki monitor --list
      if (!found.length) {
        try {
          const h = await spawnProcess(tsukiPath, ['monitor', '--list'], undefined, (line) => {
            const p = stripDecoration(line)
            if (isPortStr(p)) found.push(p)
          })
          await h.done
          h.dispose()
        } catch { /* fall through */ }
      }

      if (cancelledRef.current) return

      const seen  = new Set<string>()
      const unique = found.filter(p => { if (seen.has(p)) return false; seen.add(p); return true })

      setPorts(unique)
      if (unique.length > 0) setSelected(unique[0])
      if (unique.length === 0) setError('No serial ports detected. Connect a board and try again, or type the port manually.')
      setScanning(false)
    })()

    return () => { cancelledRef.current = true }
  }, []) // eslint-disable-line

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onResult({ cancel: true })
      if (e.key === 'Enter' && !scanning) {
        const p = selected || manual.trim()
        if (p) onResult({ port: p, cancel: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scanning, selected, manual]) // eslint-disable-line

  const effectivePort = selected || manual.trim()

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
        onClick={() => onResult({ cancel: true })}
      />

      {/* Dialog */}
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col"
        style={{
          width: 360,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] flex-shrink-0"
          style={{ background: 'var(--surface-3)' }}
        >
          <div className="flex items-center gap-2">
            <PlugZap size={14} className="text-[var(--ok)]" />
            <span className="text-sm font-semibold text-[var(--fg)]">Select upload port</span>
          </div>
          <button
            onClick={() => onResult({ cancel: true })}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent border-0 cursor-pointer transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-4">

          {/* Scanning state */}
          {scanning && (
            <div className="flex items-center gap-2 py-4 justify-center text-sm text-[var(--fg-muted)]">
              <span className="animate-spin inline-block text-base">↻</span>
              Scanning serial ports…
            </div>
          )}

          {/* Error */}
          {!scanning && error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded"
              style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <AlertTriangle size={13} className="text-[var(--warn)] mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--fg-muted)] leading-snug">{error}</p>
            </div>
          )}

          {/* Port list */}
          {!scanning && ports.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest font-semibold mb-1">
                Detected ports
              </p>
              {ports.map(p => (
                <button
                  key={p}
                  onClick={() => { setSelected(p); setManual('') }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded text-left w-full cursor-pointer border transition-colors"
                  style={{
                    background:   selected === p ? 'rgba(34,197,94,0.08)' : 'var(--surface-3)',
                    borderColor:  selected === p ? 'rgba(34,197,94,0.35)' : 'var(--border)',
                    color:        'var(--fg)',
                  }}
                >
                  {/* Radio dot */}
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: selected === p ? 'var(--ok)' : 'var(--fg-faint)',
                    }}
                  >
                    {selected === p && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)]" />
                    )}
                  </span>
                  <Radio size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
                  <span className="text-sm font-mono font-medium">{p}</span>
                </button>
              ))}
            </div>
          )}

          {/* Manual entry */}
          {!scanning && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-[10px] text-[var(--fg-faint)] uppercase tracking-widest font-semibold">
                {ports.length ? 'Or type manually' : 'Enter port manually'}
              </p>
              <input
                value={manual}
                onChange={e => { setManual(e.target.value); setSelected('') }}
                placeholder="COM3 / /dev/ttyUSB0"
                autoFocus={!ports.length}
                className="w-full px-3 py-2 rounded border text-sm font-mono outline-none transition-colors"
                style={{
                  background:   'var(--surface-3)',
                  borderColor:  manual.trim() ? 'rgba(34,197,94,0.35)' : 'var(--border)',
                  color:        'var(--fg)',
                  caretColor:   'var(--ok)',
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] flex-shrink-0"
          style={{ background: 'var(--surface-3)' }}
        >
          <button
            onClick={() => onResult({ cancel: true })}
            className="px-3 py-1.5 rounded text-xs font-medium border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const p = effectivePort
              if (p) onResult({ port: p, cancel: false })
            }}
            disabled={scanning || !effectivePort}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border border-transparent cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: effectivePort ? 'var(--ok)' : 'var(--surface-4)',
              color:      effectivePort ? '#000'      : 'var(--fg-muted)',
            }}
          >
            <PlugZap size={11} />
            Upload
          </button>
        </div>
      </div>
    </>
  )
}