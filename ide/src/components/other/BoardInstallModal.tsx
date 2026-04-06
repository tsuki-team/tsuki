'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  BoardInstallModal — board package install popup
//  Shows: README / Specs tabs in preview, then a step-by-step install UI.
//  All data comes from the tsuki_board.toml + companion files — nothing assumed.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef } from 'react'
import { useStore }       from '@/lib/store'
import type { BoardPlatform } from '@/lib/store'
import {
  X, Download, FileText, Cpu,
  CheckCircle2, AlertCircle, Loader2, Circle, Zap,
} from 'lucide-react'

type Tab    = 'readme' | 'specs'
type Phase  = 'preview' | 'installing' | 'done' | 'error'

// Installation steps — mapped from tsuki-flash output lines
type StepStatus = 'pending' | 'running' | 'done' | 'error'
interface Step {
  id:     string
  label:  string
  status: StepStatus
  detail: string    // last log line for this step
}

const INITIAL_STEPS: Step[] = [
  { id: 'manifest',  label: 'Fetching package manifest',          status: 'pending', detail: '' },
  { id: 'toolchain', label: 'Installing toolchain',               status: 'pending', detail: '' },
  { id: 'core',      label: 'Installing Arduino core',            status: 'pending', detail: '' },
  { id: 'precompile',label: 'Precompiling core libraries',        status: 'pending', detail: '' },
  { id: 'finalize',  label: 'Finalizing',                         status: 'pending', detail: '' },
]

// ── TOML parsing helpers ──────────────────────────────────────────────────────

interface BoardSpecs {
  name:       string
  arch:       string
  fqbn:       string
  variant:    string
  flashKb:    number
  ramKb:      number
  fCpu:       number
  uploadBaud: number
  uploadTool: string
  defines:    string[]
  usbEntries: { vid: string; pid: string; chip: string }[]
}

function parseTomlSpecs(toml: string): BoardSpecs | null {
  const lines = toml.split('\n')

  const get = (key: string): string => {
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith(key) && t.includes('=')) {
        return t.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
      }
    }
    return ''
  }

  const flashKb = parseInt(get('flash_kb')) || 0
  if (!flashKb) return null

  // Parse [[detection.usb]] blocks
  const usb: { vid: string; pid: string; chip: string }[] = []
  let inUsb = false
  let cur: Partial<{ vid: string; pid: string; chip: string }> = {}
  for (const line of lines) {
    const t = line.trim()
    if (t === '[[detection.usb]]') {
      if (cur.vid) usb.push(cur as { vid: string; pid: string; chip: string })
      cur = {}
      inUsb = true
      continue
    }
    if (t.startsWith('[') && !t.startsWith('[[')) inUsb = false
    if (!inUsb) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^"|"$/g, '')
    if (k === 'vid') cur.vid = v
    if (k === 'pid') cur.pid = v
    if (k === 'chip') cur.chip = v
  }
  if (cur.vid) usb.push(cur as { vid: string; pid: string; chip: string })

  // Parse defines array
  const defines: string[] = []
  let inDefines = false
  for (const line of lines) {
    const t = line.trim()
    if (t === '[defines]') { inDefines = true; continue }
    if (t.startsWith('[')) { inDefines = false; continue }
    if (!inDefines) continue
    // "VALUE", lines
    const m = t.match(/^\s*"([^"]+)"/)
    if (m) defines.push(m[1])
  }

  return {
    name:       get('name'),
    arch:       get('type') || get('arch'),
    fqbn:       get('fqbn'),
    variant:    get('variant'),
    flashKb,
    ramKb:      parseInt(get('ram_kb'))      || 0,
    fCpu:       parseInt(get('f_cpu'))        || 0,
    uploadBaud: parseInt(get('upload_baud'))  || 921600,
    uploadTool: get('upload_tool')            || 'esptool',
    defines,
    usbEntries: usb,
  }
}

function parseReadmeName(toml: string): string {
  for (const line of toml.split('\n')) {
    const t = line.trim()
    if (t.startsWith('readme') && t.includes('=')) {
      return t.split('=')[1].trim().replace(/^"|"$/g, '')
    }
  }
  return 'README.md'
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: Step; index: number }) {
  return (
    <div className="flex items-start gap-3">
      {/* Icon */}
      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center mt-0.5">
        {step.status === 'done'    && <CheckCircle2 size={14} className="text-green-400" />}
        {step.status === 'running' && <Loader2      size={14} className="text-blue-400 animate-spin" />}
        {step.status === 'error'   && <AlertCircle  size={14} className="text-red-400" />}
        {step.status === 'pending' && (
          <span className="w-4 h-4 rounded-full border border-zinc-600 flex items-center justify-center">
            <span className="text-[8px] text-zinc-600">{index + 1}</span>
          </span>
        )}
      </div>

      {/* Label + detail */}
      <div className="flex-1 min-w-0 pb-3">
        <div className={`text-[11px] font-medium ${
          step.status === 'done'    ? 'text-zinc-300' :
          step.status === 'running' ? 'text-blue-300'  :
          step.status === 'error'   ? 'text-red-300'   :
          'text-zinc-500'
        }`}>
          {step.label}
        </div>
        {step.detail && (
          <div className="text-[9px] font-mono text-zinc-600 truncate mt-0.5">
            {step.detail}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Map log output → step ─────────────────────────────────────────────────────

function classifyLine(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('manifest') || l.includes('fetching') || l.includes('downloading'))
    return 'manifest'
  if (l.includes('toolchain') || l.includes('gcc') || l.includes('xtensa') || l.includes('arm-none'))
    return 'toolchain'
  if (l.includes('core') && (l.includes('install') || l.includes('download') || l.includes('extract')))
    return 'core'
  if (l.includes('precompil') || l.includes('cache') || l.includes('compiled'))
    return 'precompile'
  if (l.includes('done') || l.includes('complete') || l.includes('✔') || l.includes('installed'))
    return 'finalize'
  return ''
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
  const store    = useStore()
  const settings = store.settings

  const [tab,         setTab]         = useState<Tab>('readme')
  const [phase,       setPhase]       = useState<Phase>('preview')
  const [specs,       setSpecs]       = useState<BoardSpecs | null>(null)
  const [readme,      setReadme]      = useState<string>('')
  const [loading,     setLoading]     = useState(true)
  const [steps,       setSteps]       = useState<Step[]>(INITIAL_STEPS)
  const [offerSwitch, setOfferSwitch] = useState(false)
  const [errorMsg,    setErrorMsg]    = useState('')
  const logsRef = useRef<string[]>([])

  // ── Fetch manifest for preview ─────────────────────────────────────────────

  useEffect(() => {
    if (!platform.url) { setLoading(false); return }
    const baseUrl = platform.url.substring(0, platform.url.lastIndexOf('/') + 1)
    let cancelled = false;

    (async () => {
      try {
        const tomlRes = await fetch(platform.url!)
        const toml    = tomlRes.ok ? await tomlRes.text() : ''
        const parsedSpecs = parseTomlSpecs(toml)
        const readmeName  = parseReadmeName(toml)

        const readmeRes = await fetch(baseUrl + readmeName)
        const readmeText = readmeRes.ok ? await readmeRes.text() : '*README not available.*'

        if (!cancelled) {
          setSpecs(parsedSpecs)
          setReadme(readmeText)
          setLoading(false)
        }
      } catch { if (!cancelled) setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [platform.url])

  // ── Install ────────────────────────────────────────────────────────────────

  const setStep = (id: string, status: StepStatus, detail = '') =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, detail } : s))

  const handleInstall = async () => {
    setPhase('installing')
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: 'pending', detail: '' })))
    setStep('manifest', 'running')

    const flashBin = settings.tsukiPath
      ? settings.tsukiPath.replace(/tsuki(\.exe)?$/, 'tsuki-flash$1')
      : 'tsuki-flash'

    const registryUrl =
      (settings.registryUrls ?? [])[0] ||
      settings.registryUrl ||
      'https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads/main/pkg/packages.json'

    try {
      const { spawnProcess } = await import('@/lib/tauri')

      let currentStep = 'manifest'
      setStep('manifest', 'running', `Fetching ${platform.id}…`)

      const handle = await spawnProcess(
        flashBin,
        ['platforms', 'install', platform.id, '--registry', registryUrl],
        undefined,
        (line: string) => {
          logsRef.current.push(line)

          // Map line to step
          const stepped = classifyLine(line)
          if (stepped && stepped !== currentStep) {
            setStep(currentStep, 'done')
            currentStep = stepped
            setStep(currentStep, 'running', line.trim())
          } else if (stepped === currentStep) {
            setStep(currentStep, 'running', line.trim())
          }
        },
      )

      const code = await handle.done
      handle.dispose()

      if (code !== 0) throw new Error(`tsuki-flash exited with code ${code}`)

      // Mark remaining steps done
      setSteps(prev => prev.map(s =>
        s.status === 'running' || s.status === 'pending'
          ? { ...s, status: 'done' }
          : s
      ))
      setPhase('done')
      setOfferSwitch(true)
      onInstalled({ ...platform, installed: true })

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(msg)
      setSteps(prev => prev.map(s =>
        s.status === 'running' ? { ...s, status: 'error', detail: msg } : s
      ))
      setPhase('error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[560px] max-h-[82vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-blue-400 shrink-0" />
              <span className="font-semibold text-zinc-100 text-sm">
                {platform.installed ? 'Board Package' : 'Install Board Package'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5 font-mono">
              {platform.id}
              <span className="mx-1.5 text-zinc-600">·</span>
              v{platform.version}
              <span className="mx-1.5 text-zinc-600">·</span>
              {platform.author}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 border-0 bg-transparent cursor-pointer">
            <X size={14} />
          </button>
        </div>

        {/* ── Tabs (preview only) ── */}
        {phase === 'preview' && (
          <div className="flex border-b border-zinc-800 px-4">
            {(['readme', 'specs'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`
                  flex items-center gap-1 px-3 py-2 text-[10px] font-medium border-b-2 transition-colors border-0 bg-transparent cursor-pointer
                  ${tab === t
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'}
                `}
              >
                {t === 'readme' && <FileText size={10} />}
                {t === 'specs'  && <Cpu      size={10} />}
                {t === 'readme' ? 'README' : 'Specs'}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Preview: README */}
          {phase === 'preview' && tab === 'readme' && (
            <div className="px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-zinc-500 gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : (
                <MarkdownView md={readme || '*No README available.*'} />
              )}
            </div>
          )}

          {/* Preview: Specs — all from tsuki_board.toml, nothing assumed */}
          {phase === 'preview' && tab === 'specs' && (
            <div className="px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-zinc-500 gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : specs ? (
                <SpecsView specs={specs} />
              ) : (
                <p className="text-zinc-500 text-xs">Could not parse board specs from manifest.</p>
              )}
            </div>
          )}

          {/* Installing: step-by-step */}
          {(phase === 'installing' || phase === 'done' || phase === 'error') && (
            <div className="px-5 py-5">
              {/* Steps list */}
              <div className="relative pl-1">
                {/* Connector line */}
                <div className="absolute left-[10px] top-5 bottom-5 w-px bg-zinc-800" />
                {steps.map((step, i) => (
                  <StepRow key={step.id} step={step} index={i} />
                ))}
              </div>

              {phase === 'done' && (
                <div className="flex items-center gap-2 mt-2 text-green-400 text-[11px] font-semibold">
                  <CheckCircle2 size={13} /> Installation complete
                </div>
              )}
              {phase === 'error' && (
                <div className="mt-2 text-red-400 text-[10px] font-mono break-all">
                  <AlertCircle size={12} className="inline mr-1" />
                  {errorMsg || 'Installation failed'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between gap-3">
          {/* Switch board offer */}
          {offerSwitch && phase === 'done' && (
            <div className="flex items-center gap-2 flex-1">
              <Zap size={11} className="text-yellow-400 shrink-0" />
              <span className="text-[10px] text-zinc-400">Switch current project to {platform.id}?</span>
              <button
                onClick={() => { store.setBoard(platform.id); onClose() }}
                className="px-2 py-0.5 rounded bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 text-[10px] border-0 cursor-pointer"
              >
                Switch
              </button>
            </div>
          )}

          <div className={`flex items-center gap-2 ${offerSwitch && phase === 'done' ? '' : 'ml-auto'}`}>
            {/* Retry on error */}
            {phase === 'error' && (
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[11px] border-0 cursor-pointer"
              >
                <Loader2 size={11} /> Retry
              </button>
            )}

            {/* Cancel / Close */}
            {phase !== 'done' && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] border-0 cursor-pointer"
              >
                {phase === 'error' ? 'Close' : 'Cancel'}
              </button>
            )}

            {/* Install button */}
            {phase === 'preview' && !platform.installed && (
              <button
                onClick={handleInstall}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium disabled:opacity-50 border-0 cursor-pointer"
              >
                <Download size={11} /> Install
              </button>
            )}

            {phase === 'done' && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[11px] border-0 cursor-pointer"
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

// ── Specs view — reads every field from the parsed toml ───────────────────────

function SpecsView({ specs }: { specs: BoardSpecs }) {
  const rows: [string, string][] = [
    ['Name',          specs.name],
    ['Architecture',  specs.arch],
    ['FQBN',          specs.fqbn],
    ['Variant',       specs.variant],
    ['Flash',         `${specs.flashKb.toLocaleString()} KB`],
    ['RAM',           `${specs.ramKb} KB`],
    ['CPU Frequency', `${(specs.fCpu / 1_000_000).toFixed(0)} MHz`],
    ['Upload Tool',   specs.uploadTool],
    ['Upload Baud',   specs.uploadBaud.toLocaleString()],
  ]

  return (
    <div className="space-y-4">
      <table className="w-full text-[10px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-800">
              <td className="py-1.5 pr-4 text-zinc-500 font-medium w-32">{k}</td>
              <td className="py-1.5 text-zinc-300 font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {specs.usbEntries.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5 font-semibold">USB detection</p>
          <div className="rounded border border-zinc-800 divide-y divide-zinc-800">
            {specs.usbEntries.map((u, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-1.5 text-[10px]">
                <span className="font-mono text-zinc-500">{u.vid}:{u.pid}</span>
                <span className="text-zinc-400">{u.chip}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {specs.defines.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5 font-semibold">Compiler defines</p>
          <div className="flex flex-wrap gap-1">
            {specs.defines.map(d => (
              <span key={d} className="font-mono text-[9px] bg-zinc-800 text-zinc-400 border border-zinc-700 rounded px-1.5 py-0.5">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Markdown viewer ───────────────────────────────────────────────────────────

function MarkdownView({ md }: { md: string }) {
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-lg font-bold text-zinc-100 mt-2 mb-1">{line.slice(2)}</h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-sm font-semibold text-zinc-200 mt-3 mb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-[11px] font-semibold text-zinc-300 mt-2 mb-0.5">{line.slice(4)}</h3>)
    } else if (line.startsWith('| ')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++ }
      const rows = tableLines
        .filter(l => !l.match(/^\|[-| ]+\|$/))
        .map(l => l.slice(1, -1).split('|').map(c => c.trim()))
      elements.push(
        <table key={i} className="w-full border-collapse text-[10px] my-2">
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-zinc-800' : ri % 2 === 0 ? 'bg-zinc-900' : ''}>
                {cells.map((c, ci) => ri === 0
                  ? <th key={ci} className="border border-zinc-700 px-2 py-1 text-left text-zinc-200 font-medium">{renderInline(c)}</th>
                  : <td key={ci} className="border border-zinc-700 px-2 py-1 text-zinc-400">{renderInline(c)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )
      continue
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 text-[11px] text-zinc-400 list-disc">{renderInline(line.slice(2))}</li>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1" />)
    } else {
      elements.push(<p key={i} className="text-[11px] text-zinc-400 leading-relaxed">{renderInline(line)}</p>)
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
