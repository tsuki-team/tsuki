'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  BoardInstallModal — install popup: README / Files / Specs + progress
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef } from 'react'
import { useStore }         from '@/lib/store'
import type { BoardPlatform } from '@/lib/store'
import {
  X, Download, FileText, List, Cpu,
  CheckCircle2, AlertCircle, Loader2, Zap,
} from 'lucide-react'

type Tab = 'readme' | 'files' | 'specs'
type Phase = 'preview' | 'installing' | 'done' | 'error'

interface BoardDetail {
  readme:    string
  files:     { name: string; size?: number; type: 'toml' | 'json' | 'md' | 'other' }[]
  specs: {
    arch:        string
    flashKb:     number
    ramKb:       number
    fCpu:        number
    fqbn:        string
    variant:     string
    uploadBaud:  number
  } | null
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BoardInstallModal({
  platform,
  onClose,
  onInstalled,
}: {
  platform:    BoardPlatform
  onClose:     () => void
  onInstalled: (p: BoardPlatform) => void
}) {
  const store = useStore()
  const settings = store.settings
  const [tab,          setTab]          = useState<Tab>('readme')
  const [phase,        setPhase]        = useState<Phase>('preview')
  const [detail,       setDetail]       = useState<BoardDetail | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [logs,         setLogs]         = useState<string[]>([])
  const [offerSwitch,  setOfferSwitch]  = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // ── Fetch companion files for preview ──────────────────────────────────────

  useEffect(() => {
    if (!platform.url) { setLoading(false); return }
    const baseUrl = platform.url.substring(0, platform.url.lastIndexOf('/') + 1)
    let cancelled = false;

    (async () => {
      try {
        const tomlRes = await fetch(platform.url!)
        const toml = tomlRes.ok ? await tomlRes.text() : ''

        const fileNames = parseFilesSection(toml)

        const readmeName = fileNames.find(f => f.toLowerCase().endsWith('.md')) ?? 'README.md'
        const readmeRes  = await fetch(baseUrl + readmeName)
        const readme = readmeRes.ok ? await readmeRes.text() : '*README not available*'

        const files = [
          { name: 'tsukiboard.toml', type: 'toml' as const, size: toml.length },
          ...fileNames.map(name => ({
            name,
            type: name.endsWith('.json') ? 'json' as const
                : name.endsWith('.md')   ? 'md'   as const
                : 'other' as const,
          })),
        ]

        const specs = parseTomlSpecs(toml)

        if (!cancelled) {
          setDetail({ readme, files, specs })
          setLoading(false)
        }
      } catch { if (!cancelled) setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [platform.url])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Install ─────────────────────────────────────────────────────────────────

  const handleInstall = async () => {
    setPhase('installing')
    setLogs([`Installing ${platform.name} v${platform.version}…`])

    const flashBin = resolveFlashBin(settings.tsukiPath ?? '')
    const registryUrl = settings.boardsRegistryUrl ||
      'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json'

    const args = [
      'platforms', 'install', platform.id,
      '--registry', registryUrl,
    ]

    try {
      const { spawnProcess } = await import('@/lib/tauri')
      const handle = await spawnProcess(
        flashBin,
        args,
        undefined,
        (line: string) => setLogs(prev => [...prev, line]),
      )
      const code = await handle.done
      handle.dispose()
      if (code !== 0) throw new Error(`exit ${code}`)
      setPhase('done')
      setOfferSwitch(true)
      onInstalled({ ...platform, installed: true })
    } catch (e: unknown) {
      setLogs(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`])
      setPhase('error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[560px] max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-blue-400 shrink-0" />
              <span className="font-semibold text-zinc-100 text-sm">
                {platform.installed ? 'Board Platform' : 'Install Platform'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              {platform.name}
              <span className="mx-1.5 text-zinc-600">·</span>
              v{platform.version}
              <span className="mx-1.5 text-zinc-600">·</span>
              {platform.author}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200">
            <X size={14} />
          </button>
        </div>

        {/* ── Tabs (only in preview phase) ── */}
        {phase === 'preview' && (
          <div className="flex border-b border-zinc-800 px-4">
            {(['readme', 'files', 'specs'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`
                  flex items-center gap-1 px-3 py-2 text-[10px] font-medium border-b-2 transition-colors
                  ${tab === t
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'}
                `}
              >
                {t === 'readme' && <FileText size={10} />}
                {t === 'files'  && <List size={10} />}
                {t === 'specs'  && <Cpu size={10} />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'files' && detail && ` (${detail.files.length})`}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {phase === 'preview' && (
            <>
              {loading && (
                <div className="flex justify-center items-center py-12 text-zinc-500">
                  <Loader2 size={16} className="animate-spin mr-2" /> Loading preview…
                </div>
              )}
              {!loading && tab === 'readme' && (
                <div className="px-5 py-4">
                  <MarkdownView md={detail?.readme ?? '*No README available.*'} />
                </div>
              )}
              {!loading && tab === 'files' && (
                <div className="px-5 py-4 space-y-1">
                  {detail?.files.map(f => (
                    <FileRow key={f.name} name={f.name} type={f.type} size={f.size} />
                  ))}
                </div>
              )}
              {!loading && tab === 'specs' && (
                <div className="px-5 py-4">
                  {detail?.specs
                    ? <SpecsTable specs={detail.specs} />
                    : <span className="text-zinc-500 text-xs">Specs not available.</span>
                  }
                </div>
              )}
            </>
          )}

          {(phase === 'installing' || phase === 'done' || phase === 'error') && (
            <div className="px-5 py-4 font-mono text-[10px] text-zinc-300 space-y-0.5">
              {logs.map((line, i) => (
                <div key={i} className={
                  line.startsWith('Error') ? 'text-red-400'
                  : line.includes('✔') || line.includes('done') ? 'text-green-400'
                  : line.includes('…') || line.includes('ing') ? 'text-blue-300'
                  : 'text-zinc-400'
                }>
                  {line}
                </div>
              ))}
              {phase === 'installing' && (
                <div className="flex items-center gap-1.5 text-blue-400 mt-1">
                  <Loader2 size={10} className="animate-spin" /> running…
                </div>
              )}
              {phase === 'done' && (
                <div className="flex items-center gap-1.5 text-green-400 mt-2 font-semibold">
                  <CheckCircle2 size={12} /> Installation complete
                </div>
              )}
              {phase === 'error' && (
                <div className="flex items-center gap-1.5 text-red-400 mt-2 font-semibold">
                  <AlertCircle size={12} /> Installation failed
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between gap-3">
          {offerSwitch && phase === 'done' && (
            <div className="flex items-center gap-2 flex-1">
              <Zap size={11} className="text-yellow-400 shrink-0" />
              <span className="text-[10px] text-zinc-400">Switch current project to {platform.name}?</span>
              <button
                onClick={() => {
                  store.setBoard(platform.id)
                  onClose()
                }}
                className="px-2 py-0.5 rounded bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 text-[10px]"
              >
                Switch
              </button>
            </div>
          )}

          <div className={`flex items-center gap-2 ${offerSwitch && phase === 'done' ? '' : 'ml-auto'}`}>
            {phase !== 'done' && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px]"
              >
                {phase === 'error' ? 'Close' : 'Cancel'}
              </button>
            )}
            {phase === 'preview' && !platform.installed && (
              <button
                onClick={handleInstall}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium disabled:opacity-50"
              >
                <Download size={11} /> Install Platform
              </button>
            )}
            {phase === 'done' && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[11px]"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MarkdownView({ md }: { md: string }) {
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-lg font-bold text-zinc-100 mt-2 mb-1">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-base font-semibold text-zinc-200 mt-3 mb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-[11px] font-semibold text-zinc-300 mt-2 mb-0.5">{line.slice(4)}</h3>)
    } else if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="bg-zinc-950 border border-zinc-800 rounded p-2 my-2 text-[10px] text-green-300 font-mono overflow-x-auto whitespace-pre">
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.startsWith('| ')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      const rows = tableLines
        .filter(l => !l.match(/^\|[-| ]+\|$/))
        .map(l => l.slice(1, -1).split('|').map(c => c.trim()))
      elements.push(
        <table key={i} className="w-full border-collapse text-[10px] my-2">
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-zinc-800' : ri % 2 === 0 ? 'bg-zinc-900' : ''}>
                {cells.map((c, ci) => (
                  ri === 0
                    ? <th key={ci} className="border border-zinc-700 px-2 py-1 text-left text-zinc-200 font-medium">{c}</th>
                    : <td key={ci} className="border border-zinc-700 px-2 py-1 text-zinc-400">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 text-[11px] text-zinc-400 list-disc">
          {renderInline(line.slice(2))}
        </li>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(
        <p key={i} className="text-[11px] text-zinc-400 leading-relaxed">
          {renderInline(line)}
        </p>
      )
    }
    i++
  }
  return <div className="space-y-0.5">{elements}</div>
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} className="bg-zinc-800 rounded px-1 font-mono text-[9px] text-green-300">{p.slice(1,-1)}</code>
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i} className="text-zinc-200 font-semibold">{p.slice(2,-2)}</strong>
    return <span key={i}>{p}</span>
  })
}

function FileRow({ name, type, size }: { name: string; type: string; size?: number }) {
  const iconColor = type === 'toml' ? 'text-orange-400' : type === 'json' ? 'text-blue-400' : type === 'md' ? 'text-green-400' : 'text-zinc-400'
  return (
    <div className="flex items-center gap-2 py-1 border-b border-zinc-800 last:border-0">
      <span className={`font-mono text-[9px] uppercase font-semibold w-8 shrink-0 ${iconColor}`}>{type}</span>
      <span className="text-[10px] text-zinc-300 font-mono">{name}</span>
      {size !== undefined && (
        <span className="ml-auto text-[9px] text-zinc-600">{(size / 1024).toFixed(1)} KB</span>
      )}
    </div>
  )
}

function SpecsTable({ specs }: { specs: NonNullable<BoardDetail['specs']> }) {
  const rows: [string, string][] = [
    ['Architecture',  specs.arch],
    ['Flash',         `${specs.flashKb.toLocaleString()} KB`],
    ['RAM',           `${specs.ramKb} KB`],
    ['CPU Frequency', `${(specs.fCpu / 1_000_000).toFixed(0)} MHz`],
    ['FQBN',          specs.fqbn],
    ['Variant',       specs.variant],
    ['Upload Baud',   specs.uploadBaud.toLocaleString()],
  ]
  return (
    <table className="w-full text-[10px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-zinc-800">
            <td className="py-1.5 pr-4 text-zinc-500 font-medium w-36">{k}</td>
            <td className="py-1.5 text-zinc-300 font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFilesSection(toml: string): string[] {
  const files: string[] = []
  let inFiles = false
  for (const line of toml.split('\n')) {
    const t = line.trim()
    if (t === '[files]') { inFiles = true; continue }
    if (t.startsWith('[')) { inFiles = false; continue }
    if (!inFiles) continue
    const eq = t.indexOf('=')
    if (eq >= 0) {
      const val = t.slice(eq + 1).trim().replace(/^"|"$/g, '')
      if (val) files.push(val)
    }
  }
  return files
}

function parseTomlSpecs(toml: string): BoardDetail['specs'] {
  const get = (key: string) => {
    for (const line of toml.split('\n')) {
      const t = line.trim()
      if (t.startsWith(key) && t.includes('=')) {
        return t.split('=')[1].trim().replace(/^"|"$/g, '')
      }
    }
    return ''
  }
  const flashKb = parseInt(get('flash_kb')) || 0
  if (!flashKb) return null
  return {
    arch:       get('type') || get('arch'),
    flashKb,
    ramKb:      parseInt(get('ram_kb')) || 0,
    fCpu:       parseInt(get('f_cpu')) || 0,
    fqbn:       get('fqbn'),
    variant:    get('variant'),
    uploadBaud: parseInt(get('upload_baud')) || 921600,
  }
}

function resolveFlashBin(tsukiPath: string): string {
  if (!tsukiPath) return 'tsuki-flash'
  return tsukiPath.replace(/tsuki(\.exe)?$/, 'tsuki-flash$1')
}
