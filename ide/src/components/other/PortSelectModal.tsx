'use client'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { PlugZap, X, Radio, AlertTriangle, RefreshCw } from 'lucide-react'
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

interface DetectedPort {
  port:      string   // "COM3", "/dev/ttyUSB0"
  boardId:   string   // "nano", "unknown", …
  vidPid:    string   // "1A86:7523" or "—"
  boardName: string   // "Arduino Nano / clone (CH340)" or "—"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPortStr(s: string): boolean {
  return s.startsWith('COM') ||
         s.startsWith('/dev/tty') ||
         s.startsWith('/dev/cu.')
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Parse one line from `tsuki-flash detect` output.
 *
 * The detect command prints a padded table:
 *   "  COM1                  unknown          —         —"
 *   "  COM4                  nano             1A86:7523  Arduino Nano / clone (CH340)"
 *
 * We split on whitespace and take:
 *   fields[0] → port  (the ONLY field we pass to avrdude)
 *   fields[1] → board_id
 *   fields[2] → vid:pid
 *   fields[3+] → board_name
 *
 * Previously the entire trimmed line was stored as the port, which caused
 * avrdude to receive "COM1                  unknown          —         —"
 * instead of "COM1" → instant failure.
 */
function parseDetectLine(line: string): DetectedPort | null {
  const clean  = stripAnsi(line)
  const fields = clean.trim().split(/\s+/)
  if (!fields.length) return null

  const port = fields[0]
  if (!isPortStr(port)) return null   // header row or empty

  const boardId   = fields[1] || '—'
  const vidPid    = fields[2] || '—'
  // board_name may be multiple words; filter stray "—" sentinel tokens
  const boardName = fields.slice(3).join(' ').replace(/^—$/, '—') || '—'

  return { port, boardId, vidPid, boardName }
}

/** Human-readable subtitle shown under the port name in the list. */
function portSubtitle(p: DetectedPort): string {
  if (p.boardName !== '—') return p.boardName
  if (p.vidPid    !== '—') return p.vidPid
  if (p.boardId   !== '—' && p.boardId !== 'unknown') return p.boardId
  return 'Unknown device'
}

/** True when we have a recognised board for this port. */
function isKnownBoard(p: DetectedPort): boolean {
  return p.boardId !== '—' && p.boardId !== 'unknown'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortSelectModal({ onResult }: Props) {
  const { settings } = useStore()

  const tsukiFlashBin = (settings.tsukiFlashPath?.trim() || 'tsuki-flash').replace(/^"|"$/g, '')
  const tsukiPath     = (settings.tsukiPath?.trim()      || 'tsuki').replace(/^"|"$/g, '')

  const [ports,    setPorts   ] = useState<DetectedPort[]>([])
  const [selected, setSelected] = useState('')
  const [scanning, setScanning ] = useState(true)
  const [error,    setError   ] = useState('')
  const [manual,   setManual  ] = useState('')

  const cancelledRef = useRef(false)

  // ── Port scan ───────────────────────────────────────────────────────────────

  const runScan = () => {
    setPorts([])
    setSelected('')
    setError('')
    setScanning(true)
    cancelledRef.current = false

    if (!isTauri()) {
      setScanning(false)
      setError('Port detection is only available in the desktop app.')
      return
    }

    ;(async () => {
      const found: DetectedPort[] = []

      // ── Primary: tsuki-flash detect --json ──────────────────────────────
      // Each line is a JSON object (NDJSON):
      //   {"port":"COM3","board_id":"nano","vid_pid":"1A86:7523","board_name":"Arduino Nano / clone (CH340)"}
      //
      // Requires tsuki-flash ≥ the version that added --json.
      // On older binaries the flag is unknown so we fall through to the
      // legacy table parser below.
      let jsonOk = false
      try {
        const h = await spawnProcess(tsukiFlashBin, ['detect', '--json'], undefined, (line) => {
          const clean = line.trim()
          if (!clean.startsWith('{')) return
          try {
            const obj = JSON.parse(clean)
            if (typeof obj.port === 'string' && isPortStr(obj.port)) {
              found.push({
                port:      obj.port,
                boardId:   typeof obj.board_id   === 'string' ? obj.board_id   : '—',
                vidPid:    typeof obj.vid_pid     === 'string' ? obj.vid_pid    : '—',
                boardName: typeof obj.board_name  === 'string' ? obj.board_name : '—',
              })
              jsonOk = true
            }
          } catch { /* malformed line — skip */ }
        })
        await h.done
        h.dispose()
      } catch { /* fall through */ }

      // ── Fallback A: tsuki-flash detect (legacy human table) ─────────────
      // The detect command prints a fixed-width padded table:
      //   "  COM1                  unknown          —         —"
      //
      // parseDetectLine() extracts ONLY the first whitespace token as the
      // port so we never send a garbage string like
      //   "COM1                  unknown          —         —"
      // to avrdude.
      if (!found.length && !jsonOk) {
        try {
          const h = await spawnProcess(tsukiFlashBin, ['detect'], undefined, (line) => {
            const p = parseDetectLine(line)
            if (p) found.push(p)
          })
          await h.done
          h.dispose()
        } catch { /* fall through */ }
      }

      // ── Fallback B: tsuki monitor --list ────────────────────────────────
      if (!found.length) {
        try {
          const h = await spawnProcess(tsukiPath, ['monitor', '--list'], undefined, (line) => {
            const clean  = stripAnsi(line)
            const fields = clean.trim().split(/\s+/)
            const port   = fields[0] || ''
            if (isPortStr(port)) {
              found.push({ port, boardId: '—', vidPid: '—', boardName: '—' })
            }
          })
          await h.done
          h.dispose()
        } catch { /* give up */ }
      }

      if (cancelledRef.current) return

      // Deduplicate by port string
      const seen   = new Set<string>()
      const unique = found.filter(p => {
        if (seen.has(p.port)) return false
        seen.add(p.port)
        return true
      })

      // Sort: known boards first, then alphabetically
      unique.sort((a, b) => {
        const aKnown = isKnownBoard(a) ? 0 : 1
        const bKnown = isKnownBoard(b) ? 0 : 1
        if (aKnown !== bKnown) return aKnown - bKnown
        return a.port.localeCompare(b.port)
      })

      setPorts(unique)
      if (unique.length > 0) setSelected(unique[0].port)
      if (unique.length === 0) setError('No serial ports detected. Connect a board and try again, or type the port manually.')
      setScanning(false)
    })()
  }

  useEffect(() => {
    runScan()
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
          width: 'min(380px, 94vw)',
          maxHeight: '85vh',
          overflow: 'hidden',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
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
          <div className="flex items-center gap-1">
            {/* Re-scan button */}
            <button
              onClick={runScan}
              disabled={scanning}
              title="Re-scan ports"
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent border-0 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => onResult({ cancel: true })}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] bg-transparent border-0 cursor-pointer transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-4 overflow-y-auto flex-1 min-h-0">

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
              {ports.map(p => {
                const isSelected = selected === p.port
                const known      = isKnownBoard(p)
                const subtitle   = portSubtitle(p)
                return (
                  <button
                    key={p.port}
                    onClick={() => { setSelected(p.port); setManual('') }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded text-left w-full cursor-pointer border transition-colors"
                    style={{
                      background:  isSelected ? 'rgba(34,197,94,0.08)' : 'var(--surface-3)',
                      borderColor: isSelected ? 'rgba(34,197,94,0.35)' : 'var(--border)',
                      color:       'var(--fg)',
                    }}
                  >
                    {/* Radio dot */}
                    <span
                      className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors"
                      style={{ borderColor: isSelected ? 'var(--ok)' : 'var(--fg-faint)' }}
                    >
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)]" />
                      )}
                    </span>

                    <Radio size={11} className="text-[var(--fg-faint)] flex-shrink-0" />

                    {/* Port name + board info */}
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-mono font-medium leading-tight">{p.port}</span>
                      {subtitle !== '—' && (
                        <span
                          className="text-[10px] leading-tight truncate"
                          style={{ color: known ? 'var(--ok)' : 'var(--fg-faint)' }}
                        >
                          {subtitle}
                          {p.vidPid !== '—' && subtitle !== p.vidPid && (
                            <span className="ml-1 opacity-50">{p.vidPid}</span>
                          )}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
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
                  background:  'var(--surface-3)',
                  borderColor: manual.trim() ? 'rgba(34,197,94,0.35)' : 'var(--border)',
                  color:       'var(--fg)',
                  caretColor:  'var(--ok)',
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