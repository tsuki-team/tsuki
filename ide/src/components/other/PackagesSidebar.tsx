'use client'
import { useStore } from '@/lib/store'
import { useState, useEffect, useCallback } from 'react'
import { loadRegistry } from '@/lib/packageRegistry'
import {
  Package, RefreshCw, Search, Download, Plus, Minus,
  ExternalLink, CheckCircle2, AlertCircle, Loader2, X,
  Info, Cpu, BookOpen, Code2,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Built-in registry fallback ────────────────────────────────────────────────
// Mirrors BUILTIN_REGISTRY in SettingsScreen — must be kept in sync manually.

const BUILTIN_REGISTRY_URL = 'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/pkg/packages.json'

// ── Per-package operation state ───────────────────────────────────────────────

type PkgOpState = {
  downloading?: boolean
  adding?:      boolean
  removing?:    boolean
  error?:       string
  done?:        boolean   // flash ✓ for 1.8 s then clear
}

// ── TOML detail types ─────────────────────────────────────────────────────────

interface PkgFunction  { go?: string; python?: string; cpp?: string }
interface PkgConstant  { go?: string; python?: string; cpp?: string }

interface PkgDetail {
  name:         string
  version?:     string
  description?: string
  author?:      string
  cpp_header?:  string
  cpp_class?:   string
  arduino_lib?: string
  functions:    PkgFunction[]
  constants:    PkgConstant[]
  readme?:      string
}

// ── Minimal TOML parser ───────────────────────────────────────────────────────

function parseToml(raw: string): PkgDetail {
  const lines  = raw.split('\n').map(l => l.trim())
  const detail: PkgDetail = { name: '', functions: [], constants: [] }
  let section: 'package' | 'function' | 'constant' | 'other' = 'other'
  let current: Record<string, string> = {}

  function flush() {
    if (section === 'function' && Object.keys(current).length)
      detail.functions.push({ go: current.go, python: current.python, cpp: current.cpp })
    if (section === 'constant' && Object.keys(current).length)
      detail.constants.push({ go: current.go, python: current.python, cpp: current.cpp })
    current = {}
  }

  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue
    if (line === '[package]')    { flush(); section = 'package';  continue }
    if (line === '[[function]]') { flush(); section = 'function'; continue }
    if (line === '[[constant]]') { flush(); section = 'constant'; continue }
    if (line.startsWith('['))    { flush(); section = 'other';    continue }

    const eq  = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^"|"$/g, '')

    if (section === 'package') {
      if (key === 'name')        detail.name        = val
      if (key === 'version')     detail.version     = val
      if (key === 'description') detail.description = val
      if (key === 'author')      detail.author      = val
      if (key === 'cpp_header')  detail.cpp_header  = val
      if (key === 'cpp_class')   detail.cpp_class   = val
      if (key === 'arduino_lib') detail.arduino_lib = val
    } else {
      current[key] = val
    }
  }
  flush()
  return detail
}

// ── Derive README URL from TOML URL ──────────────────────────────────────────
// TOML:   .../pkg/dht/v1.0.0/godotinolib.toml
// README: .../pkg/dht/README.md

function readmeUrlFromToml(tomlUrl: string): string | null {
  const match = tomlUrl.match(/^(.+\/pkg\/[^/]+)\//)
  return match ? `${match[1]}/README.md` : null
}

// ── Simple markdown renderer ──────────────────────────────────────────────────

function InlineMarkdown({ src }: { src: string }) {
  const parts = src.split(/(`[^`]+`|\*\*[^*]+\*\*)/)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={i} className="font-semibold text-[var(--fg)]">{p.slice(2, -2)}</strong>
        if (p.startsWith('`') && p.endsWith('`'))
          return <code key={i} className="font-mono text-[10px] bg-[var(--surface-3)] px-1 rounded">{p.slice(1, -1)}</code>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

function MarkdownBlock({ src }: { src: string }) {
  const lines = src.split('\n')
  const out: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++ }
      out.push(
        <pre key={i} className="my-2 rounded bg-[var(--surface-3)] border border-[var(--border)] p-3 overflow-x-auto text-[10px] leading-relaxed font-mono text-[var(--fg-muted)]">
          {code.join('\n')}
        </pre>
      )
      i++; continue
    }

    // HR
    if (/^-{3,}$/.test(line.trim())) {
      out.push(<hr key={i} className="border-[var(--border)] my-3" />)
      i++; continue
    }

    // Heading
    const hm = line.match(/^(#{1,4})\s+(.+)/)
    if (hm) {
      const level = hm[1].length
      const cls = clsx(
        'font-semibold text-[var(--fg)] mt-4 mb-1',
        level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-xs',
      )
      out.push(<div key={i} className={cls}>{hm[2]}</div>)
      i++; continue
    }

    // Table
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[-|: ]+\|$/.test(lines[i]))
          rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()))
        i++
      }
      if (rows.length > 0) {
        out.push(
          <div key={i} className="overflow-x-auto my-2">
            <table className="text-[10px] border-collapse w-full">
              {rows.map((row, ri) => (
                <tr key={ri} className={ri === 0 ? 'border-b border-[var(--border)]' : 'border-b border-[var(--border-subtle)]'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={clsx('px-2 py-1 align-top', ri === 0 ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg-muted)]')}>
                      <InlineMarkdown src={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </table>
          </div>
        )
      }
      continue
    }

    if (line.trim() === '') { out.push(<div key={i} className="h-1" />); i++; continue }

    out.push(
      <p key={i} className="text-[11px] text-[var(--fg-muted)] leading-relaxed mb-1">
        <InlineMarkdown src={line} />
      </p>
    )
    i++
  }
  return <div>{out}</div>
}

// ── Package detail popup ──────────────────────────────────────────────────────

type DetailTab = 'overview' | 'api' | 'info'

function PackageDetailModal({
  pkg, op, onClose, onDownload, onAdd, onRemove,
}: {
  pkg:        import('@/lib/store').PackageEntry
  op:         PkgOpState
  onClose:    () => void
  onDownload: () => void
  onAdd:      () => void
  onRemove:   () => void
}) {
  const [tab,      setTab     ] = useState<DetailTab>('overview')
  const [detail,   setDetail  ] = useState<PkgDetail | null>(null)
  const [loading,  setLoading ] = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const busy = !!(op.downloading || op.adding || op.removing)

  useEffect(() => {
    if (!pkg.url) { setLoading(false); return }
    let cancelled = false
    async function load() {
      try {
        const tomlRes = await fetch(pkg.url!, { cache: 'no-cache' })
        if (!tomlRes.ok) throw new Error(`HTTP ${tomlRes.status}`)
        const parsed  = parseToml(await tomlRes.text())

        let readme: string | undefined
        const rUrl = readmeUrlFromToml(pkg.url!)
        if (rUrl) {
          try {
            const rr = await fetch(rUrl, { cache: 'no-cache' })
            if (rr.ok) readme = await rr.text()
          } catch { /* optional */ }
        }

        if (!cancelled) { setDetail({ ...parsed, readme }); setLoading(false) }
      } catch (e: unknown) {
        if (!cancelled) { setFetchErr(e instanceof Error ? e.message : String(e)); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [pkg.url])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="flex flex-col rounded-xl border border-[var(--border)] shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface)', width: 560, maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <Package size={16} style={{ color: 'var(--fg-muted)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-base text-[var(--fg)]">{pkg.name}</span>
              <span className="text-xs font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                {pkg.version}
              </span>
              {pkg.installed && (
                <span className="text-[10px] font-mono text-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] px-1.5 py-0.5 rounded">
                  installed
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5 leading-snug">{pkg.desc}</p>
            {detail?.author && (
              <p className="text-[10px] text-[var(--fg-faint)] mt-0.5">by {detail.author}</p>
            )}
          </div>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors flex-shrink-0">
            <X size={13} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-5 border-b border-[var(--border)] flex-shrink-0" style={{ background: 'var(--surface-1)' }}>
          {([
            { id: 'overview' as DetailTab, label: 'Overview', icon: <BookOpen size={11} /> },
            { id: 'api'      as DetailTab, label: 'API',      icon: <Code2    size={11} /> },
            { id: 'info'     as DetailTab, label: 'Details',  icon: <Cpu      size={11} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-0 bg-transparent cursor-pointer transition-colors relative',
                tab === t.id ? 'text-[var(--fg)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg-muted)]',
              )}>
              {t.icon}{t.label}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--fg)] rounded-t" />}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-[var(--fg-faint)] py-8 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading package info…
            </div>
          )}
          {fetchErr && !loading && (
            <div className="flex items-start gap-2 text-xs text-[var(--err)] py-4">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>Could not load package details: {fetchErr}</span>
            </div>
          )}
          {!loading && !fetchErr && detail && (
            <>
              {tab === 'overview' && (
                detail.readme
                  ? <MarkdownBlock src={detail.readme} />
                  : <div className="text-xs text-[var(--fg-faint)] py-8 text-center">No README available for this package.</div>
              )}

              {tab === 'api' && (
                <div className="flex flex-col gap-4">
                  {detail.functions.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-2">Functions</div>
                      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                        <table className="text-[10px] w-full border-collapse">
                          <thead>
                            <tr style={{ background: 'var(--surface-2)' }}>
                              {['Go', 'Python', 'C++ output'].map(h => (
                                <th key={h} className="text-left px-3 py-2 font-semibold text-[var(--fg-muted)] border-b border-[var(--border)]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {detail.functions.map((fn, i) => (
                              <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--hover)]">
                                <td className="px-3 py-1.5 font-mono text-sky-400">{fn.go ?? '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-emerald-400">{fn.python ?? '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-[var(--fg-faint)]">{fn.cpp ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {detail.constants.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] mb-2">Constants</div>
                      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                        <table className="text-[10px] w-full border-collapse">
                          <thead>
                            <tr style={{ background: 'var(--surface-2)' }}>
                              {['Go', 'Python', 'C++ value'].map(h => (
                                <th key={h} className="text-left px-3 py-2 font-semibold text-[var(--fg-muted)] border-b border-[var(--border)]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {detail.constants.map((c, i) => (
                              <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--hover)]">
                                <td className="px-3 py-1.5 font-mono text-amber-400">{c.go ?? '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-amber-400">{c.python ?? '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-[var(--fg-faint)]">{c.cpp ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {detail.functions.length === 0 && detail.constants.length === 0 && (
                    <div className="text-xs text-[var(--fg-faint)] py-6 text-center">No API info available.</div>
                  )}
                </div>
              )}

              {tab === 'info' && (
                <div className="flex flex-col gap-2">
                  {(
                    [
                      { label: 'Package name', value: detail.name        },
                      { label: 'Version',      value: detail.version     },
                      { label: 'Author',       value: detail.author      },
                      { label: 'C++ header',   value: detail.cpp_header  },
                      { label: 'C++ class',    value: detail.cpp_class   },
                      { label: 'Arduino lib',  value: detail.arduino_lib },
                    ] as { label: string; value?: string }[]
                  ).filter(r => r.value).map(row => (
                    <div key={row.label} className="flex items-baseline gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-0">
                      <span className="text-[10px] text-[var(--fg-faint)] w-28 flex-shrink-0">{row.label}</span>
                      <span className="text-[11px] font-mono text-[var(--fg-muted)]">{row.value}</span>
                    </div>
                  ))}
                  {detail.arduino_lib && (
                    <div className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[color-mix(in_srgb,var(--warn)_6%,transparent)] border border-[color-mix(in_srgb,var(--warn)_20%,transparent)]">
                      <AlertCircle size={11} className="text-[var(--warn)] mt-0.5 flex-shrink-0" />
                      <p className="text-[10px] text-[var(--fg-muted)] leading-relaxed">
                        Requires the <strong className="text-[var(--fg)]">{detail.arduino_lib}</strong> Arduino library.
                        It will be installed automatically when you run{' '}
                        <code className="font-mono bg-[var(--surface-3)] px-1 rounded">tsuki pkg install {detail.name}</code>.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-shrink-0" style={{ background: 'var(--surface-1)' }}>
          {op.done ? (
            <div className="flex items-center gap-1.5 text-xs text-[var(--ok)]">
              <CheckCircle2 size={13} /> Done
            </div>
          ) : pkg.installed ? (
            <button onClick={onRemove} disabled={busy}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors',
                busy
                  ? 'opacity-40 cursor-not-allowed border-[var(--border)] bg-transparent text-[var(--fg-faint)]'
                  : 'border-[color-mix(in_srgb,var(--err)_40%,transparent)] bg-[color-mix(in_srgb,var(--err)_8%,transparent)] text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_14%,transparent)]',
              )}>
              {op.removing
                ? <><Loader2 size={11} className="animate-spin" /> Removing…</>
                : <><Minus size={11} /> Remove from project</>
              }
            </button>
          ) : (
            <>
              <button onClick={onDownload} disabled={busy}
                title="tsuki pkg install — downloads C++ library to disk only"
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors',
                  busy
                    ? 'opacity-40 cursor-not-allowed border-[var(--border)] bg-transparent text-[var(--fg-faint)]'
                    : 'border-[var(--border)] bg-[var(--surface-3)] text-[var(--fg)] hover:bg-[var(--hover)]',
                )}>
                {op.downloading
                  ? <><Loader2 size={11} className="animate-spin" /> Installing…</>
                  : <><Download size={11} /> Install</>
                }
              </button>
              <button onClick={onAdd} disabled={busy}
                title="tsuki pkg install + add — installs and adds to project manifest"
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors',
                  busy
                    ? 'opacity-40 cursor-not-allowed border-[var(--border)] bg-transparent text-[var(--fg-faint)]'
                    : 'border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_8%,transparent)] text-[var(--ok)] hover:bg-[color-mix(in_srgb,var(--ok)_14%,transparent)]',
                )}>
                {op.adding
                  ? <><Loader2 size={11} className="animate-spin" /> Adding…</>
                  : <><Plus size={11} /> Add to project</>
                }
              </button>
            </>
          )}
          {op.error && (
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--err)] ml-1">
              <AlertCircle size={10} /> {op.error}
            </div>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Indeterminate progress bar ────────────────────────────────────────────────

function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div className={clsx('w-full h-0.5 bg-[var(--surface-3)] rounded-full overflow-hidden relative', className)}>
      <div className="absolute h-full w-1/3 bg-[var(--fg-muted)] rounded-full"
        style={{ animation: 'indeterminate 1.2s ease-in-out infinite' }} />
      <style>{`@keyframes indeterminate{0%{left:-33%}100%{left:100%}}`}</style>
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function PackagesSidebar() {
  const {
    packages, togglePackage, setPackageInstalling,
    addLog, settings, projectPath,
    dispatchCommand, dispatchBuild, setBottomTab,
    setPackages, packagesLoaded,
    syncInstalledPackages, openTabs, tree,
  } = useStore()

  const [query,     setQuery    ] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [refreshing,setRefreshing] = useState(false)
  const [opState,   setOpState  ] = useState<Record<string, PkgOpState>>({})
  const [detailPkg, setDetailPkg] = useState<import('@/lib/store').PackageEntry | null>(null)

  const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
  const cwd   = projectPath || undefined

  function patchOp(name: string, patch: Partial<PkgOpState>) {
    setOpState(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }
  function clearOp(name: string) {
    setOpState(prev => { const n = { ...prev }; delete n[name]; return n })
  }
  function flashDone(name: string) {
    patchOp(name, { done: true, error: undefined })
    setTimeout(() => clearOp(name), 1800)
  }

  // Sync installed state from manifest whenever it changes
  useEffect(() => {
    const manifestNode = tree.find(n => n.name === 'tsuki_package.json' || n.name === 'goduino.json')
    if (!manifestNode) return
    const tabContent = openTabs.find(t => t.fileId === manifestNode.id)?.content ?? manifestNode.content
    if (!tabContent) return
    try {
      const mf = JSON.parse(tabContent)
      if (Array.isArray(mf.packages)) syncInstalledPackages(mf.packages)
    } catch { /* invalid JSON while typing */ }
  }, [openTabs, tree, syncInstalledPackages])

  // Build effective URL list from registryUrls (managed by Settings UI).
  // Falls back to BUILTIN_REGISTRY_URL when no custom registries are configured.
  // Does NOT use the legacy `settings.registryUrl` field as primary source.
  const effectiveUrls = useCallback((): string[] => {
    const user = (settings.registryUrls ?? []).map((u: string) => u.trim()).filter(Boolean)
    return user.length > 0 ? user : [BUILTIN_REGISTRY_URL]
  }, [settings.registryUrls])

  // Load registry on first mount (or when registry URLs change).
  // The 5-minute in-memory cache in packageRegistry.ts prevents redundant
  // network requests — we don't need the `packagesLoaded` guard here.
  // Removing it ensures the list refreshes correctly when the component
  // remounts or the URL config changes.
  useEffect(() => {
    const [primary, ...extras] = effectiveUrls()
    loadRegistry(primary, packages, false, extras)
      .then(entries => { setPackages(entries); setLoadError(false) })
      .catch(() => setLoadError(true))
  }, [settings.registryUrls]) // eslint-disable-line

  // ── Re-read tsuki_package.json from disk and sync installed state ────────
  async function resyncManifest() {
    if (!projectPath) return
    try {
      const { readFile } = await import('@/lib/tauri')
      const raw = await readFile(projectPath + '/tsuki_package.json')
      const mf  = JSON.parse(raw)
      if (Array.isArray(mf.packages)) {
        syncInstalledPackages(mf.packages)
      }
    } catch { /* project has no manifest yet */ }
  }

  // ── Install C++ lib to disk: tsuki pkg install <n> ────────────────────────
  function handleDownload(name: string) {
    const args = ['pkg', 'install', name]
    patchOp(name, { downloading: true, error: undefined, done: false })
    setBottomTab('output')
    addLog('info', `[pkg] Running: ${tsuki} ${args.join(' ')}`)
    dispatchBuild(tsuki, args, cwd)
    // Clear spinner after 8 s; user can verify result in the Output tab
    setTimeout(() => {
      patchOp(name, { downloading: false })
      flashDone(name)
    }, 8000)
  }

  // ── Install + add to manifest ─────────────────────────────────────────────
  async function handleAdd(name: string) {
    patchOp(name, { adding: true, error: undefined, done: false })
    setBottomTab('output')
    addLog('info', `[pkg] Installing and adding "${name}" to project…`)
    setPackageInstalling(name, true)
    dispatchBuild(tsuki, ['pkg', 'install', name], cwd)
    await new Promise(r => setTimeout(r, 4000))
    dispatchBuild(tsuki, ['pkg', 'add', name], cwd)
    await new Promise(r => setTimeout(r, 1500))
    setPackageInstalling(name, false)
    togglePackage(name)
    patchOp(name, { adding: false })
    addLog('ok', `[pkg] "${name}" installed and added to project`)
    flashDone(name)
    resyncManifest()
  }

  // ── Remove from manifest + disk ───────────────────────────────────────────
  async function handleRemove(name: string) {
    patchOp(name, { removing: true, error: undefined, done: false })
    setBottomTab('output')
    addLog('info', `[pkg] Removing "${name}" from project…`)
    setPackageInstalling(name, true)
    dispatchBuild(tsuki, ['pkg', 'remove', name, '--manifest'], cwd)
    await new Promise(r => setTimeout(r, 1500))
    setPackageInstalling(name, false)
    togglePackage(name)
    patchOp(name, { removing: false })
    addLog('ok', `[pkg] "${name}" removed from project`)
    flashDone(name)
    resyncManifest()
  }

  async function handleRefresh() {
    setRefreshing(true)
    setLoadError(false)
    const { loadRegistry: lr, invalidateRegistryCache } = await import('@/lib/packageRegistry')
    invalidateRegistryCache()
    const [primary, ...extras] = effectiveUrls()
    lr(primary, packages, true, extras)
      .then(entries => {
        setPackages(entries)
        addLog('info', `[pkg] Registry refreshed — ${entries.length} package${entries.length !== 1 ? 's' : ''} found`)
      })
      .catch(() => setLoadError(true))
      .finally(() => setRefreshing(false))
  }

  const filtered  = packages.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.desc ?? '').toLowerCase().includes(query.toLowerCase())
  )
  const installed = filtered.filter(p =>  p.installed)
  const available = filtered.filter(p => !p.installed)

  return (
    <div className="flex flex-col h-full text-[var(--fg)] text-xs">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="font-semibold text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">Packages</span>
        <div className="flex items-center gap-0.5">
          <button
            title="Open registry in browser"
            onClick={() => { const [url] = effectiveUrls(); if (url) try { (window as any).__TAURI__?.shell?.open(url) } catch {} }}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors"
          ><ExternalLink size={10} /></button>
          <button
            title="Refresh registry"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors disabled:cursor-not-allowed"
          ><RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1">
          <Search size={10} className="text-[var(--fg-faint)] flex-shrink-0" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter packages…"
            className="flex-1 bg-transparent outline-none text-xs text-[var(--fg)] placeholder:text-[var(--fg-faint)] border-0"
          />
          {query && (
            <button onClick={() => setQuery('')}
              className="text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer leading-none p-0">×</button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!packagesLoaded && !loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-[var(--fg-faint)]">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">Loading registry…</span>
          </div>
        )}

        {loadError && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 px-3 text-center">
            <AlertCircle size={18} className="text-[var(--err)]" />
            <span className="text-[11px] text-[var(--err)]">Failed to load registry</span>
            <span className="text-[10px] text-[var(--fg-faint)]">Check registry URL in Settings → CLI</span>
            <button onClick={handleRefresh}
              className="mt-1 text-[10px] text-[var(--fg-faint)] hover:text-[var(--fg)] border border-[var(--border)] rounded px-2 py-0.5 bg-transparent cursor-pointer transition-colors">
              Retry
            </button>
          </div>
        )}

        {installed.length > 0 && (
          <>
            <SectionLabel label={`In project (${installed.length})`} />
            {installed.map(pkg => (
              <PkgRow key={pkg.name} pkg={pkg} op={opState[pkg.name] ?? {}}
                onInfo={() => setDetailPkg(pkg)}
                onDownload={() => handleDownload(pkg.name)}
                onAdd={() => handleAdd(pkg.name)}
                onRemove={() => handleRemove(pkg.name)}
              />
            ))}
          </>
        )}

        {available.length > 0 && (
          <>
            <SectionLabel label={`Available (${available.length})`} />
            {available.map(pkg => (
              <PkgRow key={pkg.name} pkg={pkg} op={opState[pkg.name] ?? {}}
                onInfo={() => setDetailPkg(pkg)}
                onDownload={() => handleDownload(pkg.name)}
                onAdd={() => handleAdd(pkg.name)}
                onRemove={() => handleRemove(pkg.name)}
              />
            ))}
          </>
        )}

        {packagesLoaded && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--fg-faint)]">
            <Package size={20} />
            <span className="text-xs">No packages found</span>
          </div>
        )}
      </div>

      {/* Footer legend */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0 space-y-0.5">
        <div className="flex items-center gap-1.5 text-[9px] text-[var(--fg-faint)] font-mono">
          <Download size={8} /> <span>install C++ lib to disk</span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-[var(--fg-faint)] font-mono">
          <Plus size={8} /> <span>install + add to project deps</span>
        </div>
      </div>

      {/* Detail popup */}
      {detailPkg && (
        <PackageDetailModal
          pkg={detailPkg}
          op={opState[detailPkg.name] ?? {}}
          onClose={() => setDetailPkg(null)}
          onDownload={() => handleDownload(detailPkg.name)}
          onAdd={() => handleAdd(detailPkg.name)}
          onRemove={() => handleRemove(detailPkg.name)}
        />
      )}
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 py-1 mt-1.5">
      <span className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-widest">{label}</span>
    </div>
  )
}

// ── Package row ───────────────────────────────────────────────────────────────

function PkgRow({
  pkg, op, onInfo, onDownload, onAdd, onRemove,
}: {
  pkg:        import('@/lib/store').PackageEntry
  op:         PkgOpState
  onInfo:     () => void
  onDownload: () => void
  onAdd:      () => void
  onRemove:   () => void
}) {
  const busy = !!(op.downloading || op.adding || op.removing)

  return (
    <div className={clsx(
      'flex flex-col px-3 py-1.5 transition-colors cursor-default group',
      busy ? 'bg-[var(--surface-1)]' : 'hover:bg-[var(--hover)]',
    )}>
      <div className="flex items-center gap-2">
        {/* Status dot */}
        <div className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors mt-0.5',
          op.done ? 'bg-green-400' : pkg.installed ? 'bg-[var(--ok)]' : 'bg-[var(--border)]',
        )} />

        {/* Clickable name area — opens detail popup */}
        <button onClick={onInfo} className="flex-1 min-w-0 text-left border-0 bg-transparent cursor-pointer p-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-semibold text-[var(--fg)] truncate">{pkg.name}</span>
            <span className="text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0">{pkg.version}</span>
          </div>
          {pkg.desc && (
            <div className="text-[var(--fg-muted)] text-[10px] leading-tight mt-0.5 truncate">{pkg.desc}</div>
          )}
        </button>

        {/* Info icon — revealed on hover */}
        <button onClick={onInfo} title="View package details"
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
          <Info size={10} />
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {op.done ? (
            <CheckCircle2 size={13} className="text-green-400" />
          ) : pkg.installed ? (
            <button onClick={onRemove} disabled={busy}
              title="Remove from project (tsuki pkg remove --manifest)"
              className={clsx(
                'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                busy ? 'text-[var(--fg-faint)] cursor-not-allowed' : 'text-[var(--err)] hover:bg-[var(--hover)]',
              )}>
              {op.removing ? <Loader2 size={10} className="animate-spin" /> : <Minus size={10} />}
            </button>
          ) : (
            <>
              <button onClick={onDownload} disabled={busy}
                title="Download C++ library to disk (tsuki pkg install)"
                className={clsx(
                  'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                  busy ? 'text-[var(--fg-faint)] cursor-not-allowed' : 'text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                )}>
                {op.downloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
              </button>
              <button onClick={onAdd} disabled={busy}
                title="Install + add to project manifest"
                className={clsx(
                  'w-5 h-5 flex items-center justify-center rounded cursor-pointer border-0 transition-colors',
                  busy ? 'text-[var(--fg-faint)] cursor-not-allowed' : 'text-[var(--ok)] hover:bg-[var(--hover)]',
                )}>
                {op.adding ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress indicators */}
      {op.downloading && (
        <div className="mt-1.5 pl-3.5">
          <IndeterminateBar />
          <span className="text-[9px] text-[var(--fg-faint)] mt-0.5 block">Installing… check terminal for output</span>
        </div>
      )}
      {(op.adding || op.removing) && (
        <div className="mt-1.5 pl-3.5">
          <IndeterminateBar />
          <span className="text-[9px] text-[var(--fg-faint)] mt-0.5 block">
            {op.adding ? 'Installing and adding to project…' : 'Removing…'}
          </span>
        </div>
      )}
      {op.error && (
        <div className="mt-1 flex items-center gap-1 text-[9px] text-[var(--err)] pl-3.5">
          <AlertCircle size={9} /> {op.error}
        </div>
      )}
    </div>
  )
}