'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import {
  PlugZap, Unplug, Trash2, ChevronDown, Settings2,
  Radio, Copy, Activity, Clock,
} from 'lucide-react'
import { spawnProcess, isTauri } from '@/lib/tauri'
import { clsx } from 'clsx'

// ── Constants ─────────────────────────────────────────────────────────────────

const BAUD_RATES = [
  '300','1200','2400','4800','9600','14400','19200',
  '28800','38400','57600','74880','115200','230400',
  '250000','500000','1000000','2000000',
]

const MAX_LINES   = 2000
const MAX_PLOTTER = 120   // data points kept in plotter history

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonitorLine {
  id:   number
  text: string
  dir:  'rx' | 'tx' | 'sys'
  ts:   string   // HH:MM:SS.mmm
}

interface PlotSeries {
  label:  string
  color:  string
  points: number[]
}

type NlMode    = 'nl' | 'cr' | 'crlf' | 'none'
type DispMode  = 'ascii' | 'hex'

let _mlid = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowTs(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function isPortStr(s: string): boolean {
  return s.startsWith('COM') ||
         s.startsWith('/dev/tty') ||
         s.startsWith('/dev/cu.')
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// Strip tsukiux decorations (●, ✔, leading spaces) and ANSI escapes from a line
function stripDecoration(line: string): string {
  return stripAnsi(line)
    .replace(/^[\s●✔✖▶…·─╭╰│]+/, '')
    .trim()
}

interface DetectedPortInfo {
  port:      string   // "COM3"
  boardId:   string   // "nano", "unknown", …
  vidPid:    string   // "2341:0043" or "—"
  boardName: string   // "Arduino Uno R3" or "—"
}

/**
 * Parse one line from `tsuki-flash detect` table output.
 * Takes ONLY fields[0] as the port — never the full padded line.
 */
function parseDetectLine(line: string): DetectedPortInfo | null {
  const fields = stripAnsi(line).trim().split(/\s+/)
  if (!fields.length) return null
  const port = fields[0]
  if (!isPortStr(port)) return null
  return {
    port,
    boardId:   fields[1] || '—',
    vidPid:    fields[2] || '—',
    boardName: fields.slice(3).join(' ') || '—',
  }
}

/** Label shown in the port dropdown (port + board name if known). */
function portLabel(p: DetectedPortInfo): string {
  if (p.boardName !== '—') return `${p.port}  —  ${p.boardName}`
  if (p.boardId !== '—' && p.boardId !== 'unknown') return `${p.port}  —  ${p.boardId}`
  if (p.vidPid  !== '—') return `${p.port}  (${p.vidPid})`
  return p.port
}

// Parse a line for numeric values — returns label→value pairs
// Supports:  "23.5"  "temp:23.5"  "temp=23.5"  "23.5,65.0"
function parsePlotValues(line: string): Array<{ label: string; value: number }> {
  const results: Array<{ label: string; value: number }> = []
  // Named pairs: word : number  or  word = number
  const named = /(\w+)\s*[:=]\s*(-?[\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = named.exec(line)) !== null) {
    const v = parseFloat(m[2])
    if (isFinite(v)) results.push({ label: m[1], value: v })
  }
  if (results.length) return results
  // Comma-separated numbers
  const parts = line.split(/[\s,;]+/).filter(Boolean)
  let idx = 0
  for (const p of parts) {
    const v = parseFloat(p)
    if (isFinite(v)) results.push({ label: `ch${idx++}`, value: v })
  }
  return results
}

const PLOT_COLORS = [
  '#00e5b0', '#61afef', '#e5c07b', '#e06c75',
  '#c678dd', '#56b6c2', '#98c379', '#ff7b7b',
]

// ── Mini sparkline canvas ─────────────────────────────────────────────────────

interface SparklineProps {
  series: PlotSeries[]
  height: number
}

function Sparkline({ series, height }: SparklineProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      ctx.beginPath()
      ctx.moveTo(0, (H / 4) * i)
      ctx.lineTo(W, (H / 4) * i)
      ctx.stroke()
    }

    if (!series.length) return

    // Compute global min/max across all series for consistent Y scale
    let min = Infinity, max = -Infinity
    for (const s of series) {
      for (const v of s.points) { if (v < min) min = v; if (v > max) max = v }
    }
    if (!isFinite(min)) return
    const range = max - min || 1

    for (const s of series) {
      if (s.points.length < 2) continue
      ctx.beginPath()
      ctx.strokeStyle = s.color
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      s.points.forEach((v, i) => {
        const x = (i / (MAX_PLOTTER - 1)) * W
        const y = H - ((v - min) / range) * (H - 8) - 4
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Last value dot
      const last = s.points[s.points.length - 1]
      const lx = ((s.points.length - 1) / (MAX_PLOTTER - 1)) * W
      const ly = H - ((last - min) / range) * (H - 8) - 4
      ctx.beginPath()
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = s.color
      ctx.fill()
    }
  }, [series])

  return (
    <canvas
      ref={ref}
      width={600}
      height={height}
      style={{ width: '100%', height }}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SerialMonitor() {
  const { settings, updateSetting } = useStore()

  const tsukiPath     = (settings.tsukiPath?.trim()      || 'tsuki').replace(/^"|"$/g, '')
  const tsukiFlashBin = (settings.tsukiFlashPath?.trim() || 'tsuki-flash').replace(/^"|"$/g, '')

  // ── Connection state ────────────────────────────────────────────────────────
  const [port,     setPort    ] = useState(settings.monitorPort || '')
  const [baud,     setBaud    ] = useState(settings.monitorBaud || '9600')
  const [ports,    setPorts   ] = useState<DetectedPortInfo[]>([])
  const [running,  setRunning ] = useState(false)
  const [scanning, setScanning] = useState(false)

  // ── Display state ───────────────────────────────────────────────────────────
  const [lines,      setLines     ] = useState<MonitorLine[]>([])
  const [input,      setInput     ] = useState('')
  const [nl,         setNl        ] = useState<NlMode>('nl')
  const [dispMode,   setDispMode  ] = useState<DispMode>('ascii')
  const [showCfg,    setShowCfg   ] = useState(false)
  const [showTs,     setShowTs    ] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [plotMode,   setPlotMode  ] = useState(false)

  // ── Plotter state ───────────────────────────────────────────────────────────
  const [series,   setSeries  ] = useState<PlotSeries[]>([])
  const seriesRef  = useRef<PlotSeries[]>([])

  // ── Refs ────────────────────────────────────────────────────────────────────
  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const handleRef  = useRef<Awaited<ReturnType<typeof spawnProcess>> | null>(null)

  // ── Persist settings ────────────────────────────────────────────────────────
  useEffect(() => { updateSetting('monitorPort', port) }, [port])   // eslint-disable-line
  useEffect(() => { updateSetting('monitorBaud',  baud) }, [baud])  // eslint-disable-line

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && scrollRef.current && !plotMode) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, autoScroll, plotMode])

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => () => { handleRef.current?.kill().catch(() => {}) }, [])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function push(text: string, dir: MonitorLine['dir']) {
    const line: MonitorLine = { id: _mlid++, text, dir, ts: nowTs() }
    setLines(prev => {
      const next = [...prev, line]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }

  // ── Port scan ───────────────────────────────────────────────────────────────
  const scanPorts = useCallback(async () => {
    if (!isTauri()) {
      push('⚠ Port scan only available in desktop app', 'sys')
      return
    }
    setScanning(true)
    const found: DetectedPortInfo[] = []

    // ── Primary: tsuki-flash detect --json ──────────────────────────────────
    // NDJSON output: {"port":"COM3","board_id":"uno","vid_pid":"2341:0043","board_name":"Arduino Uno R3"}
    // Requires tsuki-flash with --json support; falls through on older binaries.
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
        } catch { /* malformed — skip */ }
      })
      await h.done
      h.dispose()
    } catch { /* fall through */ }

    // ── Fallback A: tsuki-flash detect (legacy human table) ─────────────────
    // The detect command prints a padded table, e.g.:
    //   "  COM3                  uno              2341:0043  Arduino Uno R3"
    //
    // parseDetectLine() takes ONLY the first whitespace-separated token as the
    // port, so we never store "COM3                  uno  …" as the port name.
    if (!found.length && !jsonOk) {
      try {
        const h1 = await spawnProcess(tsukiFlashBin, ['detect'], undefined, (line) => {
          const p = parseDetectLine(line)
          if (p) found.push(p)
        })
        await h1.done
        h1.dispose()
      } catch { /* fall through */ }
    }

    // ── Fallback B: tsuki monitor --list ────────────────────────────────────
    if (!found.length) {
      try {
        const h2 = await spawnProcess(tsukiPath, ['monitor', '--list'], undefined, (line) => {
          const fields = stripDecoration(line).split(/\s+/)
          const p = fields[0] || ''
          if (isPortStr(p)) found.push({ port: p, boardId: '—', vidPid: '—', boardName: '—' })
        })
        await h2.done
        h2.dispose()
      } catch { /* give up */ }
    }

    // Deduplicate by port string, preserving order
    const seen   = new Set<string>()
    const unique = found.filter(p => { if (seen.has(p.port)) return false; seen.add(p.port); return true })

    setPorts(unique)
    if (unique.length > 0 && !port) setPort(unique[0].port)
    if (unique.length === 0) push('⚠ No serial ports found — connect a board and try again', 'sys')
    setScanning(false)
  }, [tsukiFlashBin, tsukiPath, port]) // eslint-disable-line

  // Auto-scan once on mount
  useEffect(() => { scanPorts() }, []) // eslint-disable-line

  // ── Connect ─────────────────────────────────────────────────────────────────
  async function connect() {
    if (!port.trim()) { push('⚠ Select or type a port first', 'sys'); return }
    if (running) return
    if (!isTauri()) { push('⚠ Serial monitor only available in desktop app', 'sys'); return }

    push(`Connecting to ${port} @ ${baud} baud…`, 'sys')
    setRunning(true)

    try {
      const handle = await spawnProcess(
        tsukiPath,
        ['monitor', '--port', port.trim(), '--baud', baud],
        undefined,
        (line, isErr) => {
          if (!line) return
          if (dispMode === 'hex') {
            const hex = Array.from(line)
              .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
              .join(' ')
            push(hex, 'rx')
          } else {
            push(line, isErr ? 'sys' : 'rx')
          }
          // Feed plotter
          if (plotMode) {
            const vals = parsePlotValues(line)
            if (vals.length) updatePlotter(vals)
          }
        },
      )
      handleRef.current = handle
      push(`Connected — port ${port}`, 'sys')
      inputRef.current?.focus()

      handle.done.then(code => {
        handleRef.current = null
        setRunning(false)
        push(`Disconnected (exit ${code})`, 'sys')
      })
    } catch (e) {
      setRunning(false)
      push(`Failed to connect: ${e}`, 'sys')
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────
  async function disconnect() {
    if (handleRef.current) {
      await handleRef.current.kill().catch(() => {})
      handleRef.current = null
    }
    setRunning(false)
    push('Disconnected.', 'sys')
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function send(text: string) {
    if (!running || !handleRef.current) return
    const suffix = nl === 'nl' ? '\n' : nl === 'cr' ? '\r' : nl === 'crlf' ? '\r\n' : ''
    try {
      await handleRef.current.write(text + suffix)
      push(text, 'tx')
    } catch (e) {
      push(`Send error: ${e}`, 'sys')
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); send(input); setInput('') }
  }

  // ── Plotter ─────────────────────────────────────────────────────────────────
  function updatePlotter(vals: Array<{ label: string; value: number }>) {
    const next = [...seriesRef.current]
    for (const { label, value } of vals) {
      const idx = next.findIndex(s => s.label === label)
      if (idx >= 0) {
        const pts = [...next[idx].points, value]
        next[idx] = { ...next[idx], points: pts.length > MAX_PLOTTER ? pts.slice(pts.length - MAX_PLOTTER) : pts }
      } else {
        next.push({ label, color: PLOT_COLORS[next.length % PLOT_COLORS.length], points: [value] })
      }
    }
    seriesRef.current = next
    setSeries([...next])
  }

  // ── Line color helper ────────────────────────────────────────────────────────
  const lineColor = (dir: MonitorLine['dir']) =>
    dir === 'tx'  ? 'var(--ok)'      :
    dir === 'sys' ? 'var(--fg-faint)' :
    'var(--fg-muted)'

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ fontFamily: '"JetBrains Mono","IBM Plex Mono",Consolas,monospace' }}
    >

      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border)] flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface-2)', minHeight: 34 }}
      >
        {/* Port selector + manual input */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-[var(--fg-faint)] select-none font-medium">Port</span>
          {ports.length > 0 && (
            <select
              value={port}
              onChange={e => setPort(e.target.value)}
              disabled={running}
              className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none cursor-pointer disabled:opacity-50"
              style={{ maxWidth: 220 }}
            >
              <option value="">— pick —</option>
              {ports.map(p => <option key={p.port} value={p.port}>{portLabel(p)}</option>)}
            </select>
          )}
          <input
            value={port}
            onChange={e => setPort(e.target.value)}
            disabled={running}
            placeholder={ports.length ? 'or type…' : 'COM3 / /dev/ttyUSB0'}
            className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none disabled:opacity-50"
            style={{ width: ports.length ? 90 : 160 }}
          />
          {/* Refresh button */}
          <button
            onClick={scanPorts}
            disabled={running || scanning}
            title="Scan ports"
            className="px-1.5 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer disabled:opacity-40 transition-colors text-[11px]"
          >
            {scanning
              ? <span className="inline-block animate-spin">↻</span>
              : '↻'
            }
          </button>
        </div>

        {/* Baud */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-[var(--fg-faint)] select-none font-medium">Baud</span>
          <select
            value={baud}
            onChange={e => setBaud(e.target.value)}
            disabled={running}
            className="text-[11px] bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--fg)] outline-none cursor-pointer disabled:opacity-50"
          >
            {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Connect / Disconnect */}
        {!running ? (
          <button
            onClick={connect}
            disabled={!port.trim()}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--ok)] hover:bg-[rgba(34,197,94,0.08)] cursor-pointer disabled:opacity-40 transition-colors font-medium"
          >
            <PlugZap size={11} /> Connect
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--err)] hover:bg-[rgba(239,68,68,0.08)] cursor-pointer transition-colors font-medium"
          >
            <Unplug size={11} /> Disconnect
          </button>
        )}

        {/* Connected indicator */}
        {running && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--ok)] flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
            {port}
          </span>
        )}

        <div className="flex-1" />

        {/* Plotter toggle */}
        <button
          onClick={() => setPlotMode(m => !m)}
          title={plotMode ? 'Switch to console' : 'Switch to plotter'}
          className={clsx(
            'p-1 rounded border border-transparent bg-transparent cursor-pointer transition-colors',
            plotMode ? 'text-[var(--fg)] bg-[var(--active)] border-[var(--border)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
          )}
        >
          <Activity size={11} />
        </button>

        {/* Timestamp toggle */}
        <button
          onClick={() => setShowTs(s => !s)}
          title={showTs ? 'Hide timestamps' : 'Show timestamps'}
          className={clsx(
            'p-1 rounded border border-transparent bg-transparent cursor-pointer transition-colors',
            showTs ? 'text-[var(--fg)] bg-[var(--active)] border-[var(--border)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
          )}
        >
          <Clock size={11} />
        </button>

        {/* Auto-scroll */}
        <button
          onClick={() => setAutoScroll(s => !s)}
          title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          className={clsx(
            'p-1 rounded border border-transparent bg-transparent cursor-pointer transition-colors',
            autoScroll ? 'text-[var(--ok)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]',
          )}
        >
          <ChevronDown size={11} />
        </button>

        {/* Config toggle */}
        <button
          onClick={() => setShowCfg(s => !s)}
          className={clsx(
            'p-1 rounded border border-transparent bg-transparent cursor-pointer transition-colors',
            showCfg ? 'text-[var(--fg)] bg-[var(--active)] border-[var(--border)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]',
          )}
        >
          <Settings2 size={11} />
        </button>

        {/* Clear */}
        <button
          onClick={() => { setLines([]); seriesRef.current = []; setSeries([]) }}
          title="Clear"
          className="p-1 rounded border border-transparent bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer transition-colors"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* ── Config panel ── */}
      {showCfg && (
        <div
          className="flex items-center gap-4 px-3 py-1.5 border-b border-[var(--border)] flex-shrink-0 flex-wrap"
          style={{ background: 'var(--surface-2)', fontSize: 11 }}
        >
          {/* Line ending */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--fg-faint)] font-medium">Line ending</span>
            {(['none','nl','cr','crlf'] as NlMode[]).map(v => (
              <button
                key={v}
                onClick={() => setNl(v)}
                className={clsx(
                  'px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors bg-transparent',
                  nl === v
                    ? 'border-[var(--fg-faint)] text-[var(--fg)]'
                    : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)]',
                )}
              >
                {v === 'none' ? 'None' : v === 'nl' ? '\\n' : v === 'cr' ? '\\r' : '\\r\\n'}
              </button>
            ))}
          </div>

          {/* Display mode */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--fg-faint)] font-medium">Display</span>
            {(['ascii','hex'] as DispMode[]).map(v => (
              <button
                key={v}
                onClick={() => setDispMode(v)}
                className={clsx(
                  'px-1.5 py-0.5 rounded border text-[10px] uppercase cursor-pointer transition-colors bg-transparent',
                  dispMode === v
                    ? 'border-[var(--fg-faint)] text-[var(--fg)]'
                    : 'border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)]',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Plotter ── */}
      {plotMode && (
        <div
          className="flex-shrink-0 border-b border-[var(--border)] flex flex-col"
          style={{ height: 140, background: 'var(--surface-1)' }}
        >
          {/* Legend */}
          {series.length > 0 && (
            <div className="flex items-center gap-3 px-3 pt-1.5 pb-0.5 flex-wrap flex-shrink-0">
              {series.map(s => (
                <span key={s.label} className="flex items-center gap-1 text-[10px] font-mono">
                  <span
                    className="inline-block w-3 h-0.5 rounded"
                    style={{ background: s.color }}
                  />
                  <span style={{ color: s.color }}>{s.label}</span>
                  <span className="text-[var(--fg-faint)]">
                    {s.points.length > 0
                      ? s.points[s.points.length - 1].toFixed(2)
                      : '—'
                    }
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="flex-1 px-2 pb-1.5 min-h-0">
            {series.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[10px] text-[var(--fg-faint)] gap-1.5">
                <Activity size={12} className="opacity-30" />
                <span>Waiting for numeric data…</span>
              </div>
            ) : (
              <Sparkline series={series} height={90} />
            )}
          </div>
        </div>
      )}

      {/* ── Console ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 pt-2 pb-1 select-text min-h-0"
        style={{ fontSize: 12, lineHeight: 1.65, scrollbarWidth: 'thin' }}
        onScroll={e => {
          const el = e.currentTarget
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
        }}
      >
        {lines.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-full gap-2 text-[var(--fg-faint)]"
            style={{ minHeight: 80 }}
          >
            <Radio size={22} className="opacity-20" />
            <span className="text-xs">Select a port and click Connect</span>
          </div>
        )}

        {lines.map(l => (
          <div
            key={l.id}
            className="flex gap-1.5 whitespace-pre-wrap break-all group"
            style={{
              color:      lineColor(l.dir),
              fontStyle:  l.dir === 'sys' ? 'italic' : undefined,
              opacity:    l.dir === 'sys' ? 0.6 : 1,
            }}
          >
            {/* Direction arrow */}
            <span
              className="select-none flex-shrink-0 w-3 text-[9px] mt-[3px]"
              style={{
                color: l.dir === 'tx'  ? 'var(--ok)'
                     : l.dir === 'rx'  ? 'var(--info)'
                     : 'transparent',
              }}
            >
              {l.dir === 'tx' ? '▲' : l.dir === 'rx' ? '▼' : '·'}
            </span>

            {/* Timestamp (optional) */}
            {showTs && (
              <span
                className="flex-shrink-0 text-[9px] mt-[3px] select-none tabular-nums"
                style={{ color: 'var(--fg-faint)', minWidth: 72 }}
              >
                {l.ts}
              </span>
            )}

            {/* Content */}
            <span className="flex-1 min-w-0">{l.text}</span>

            {/* Copy on hover */}
            <button
              onClick={() => navigator.clipboard.writeText(l.text).catch(() => {})}
              className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent flex-shrink-0 transition-opacity self-start mt-0.5"
              title="Copy"
            >
              <Copy size={9} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Input row ── */}
      <div
        className="flex items-center gap-2 px-3 border-t flex-shrink-0"
        style={{
          borderColor: 'var(--border)',
          paddingTop: 5, paddingBottom: 5,
          opacity:       running ? 1 : 0.35,
          pointerEvents: running ? 'auto' : 'none',
        }}
      >
        <span style={{ color: 'var(--ok)', fontSize: 11, flexShrink: 0, userSelect: 'none' }}>▲</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!running}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 border-0 outline-none bg-transparent min-w-0 text-[var(--fg)]"
          style={{ fontFamily: 'inherit', fontSize: 12, caretColor: 'var(--ok)' }}
          placeholder={running
            ? `Send data${nl !== 'none' ? ` + ${nl === 'nl' ? '\\n' : nl === 'cr' ? '\\r' : '\\r\\n'}` : ''}…`
            : ''
          }
        />
        <button
          onClick={() => { send(input); setInput('') }}
          disabled={!running || !input.trim()}
          className="text-[10px] px-2 py-0.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer disabled:opacity-30 transition-colors flex-shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  )
}