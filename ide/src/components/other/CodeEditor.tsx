'use client'
import { useRef, useEffect, useState, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { highlightByExt } from '@/lib/highlight'
import { showContextMenu } from '@/components/shared/ContextMenu'
import {
  runDiagnostics, getMissingLibDiags,
  type Diagnostic, type LibraryInfo,
} from '@/components/experiments/Lsp/LspEngine'
import {
  getCompletions, getHoverDoc, getSignatureHelp, getInlayHints,
  wordAtOffset,
  type CompletionItem, type HoverDoc, type SignatureHelp, type InlayHint,
} from '@/components/experiments/Lsp/LspFeatures'
import LibraryInstallModal from '@/components/experiments/Lsp/LibraryInstallModal'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'

// ── Session guard ─────────────────────────────────────────────────────────────
const _sessionPrompted = new Set<string>()

// ── Undo / Redo ───────────────────────────────────────────────────────────────

interface Snapshot { content: string; selStart: number; selEnd: number }

class UndoStack {
  private stack: Snapshot[] = []
  private ptr = -1
  private readonly MAX = 200
  push(snap: Snapshot) {
    this.stack = this.stack.slice(0, this.ptr + 1)
    const top = this.stack[this.ptr]
    if (top && top.content === snap.content) return
    this.stack.push(snap)
    if (this.stack.length > this.MAX) this.stack.shift()
    this.ptr = this.stack.length - 1
  }
  undo(): Snapshot | null { if (this.ptr <= 0) return null; this.ptr--; return this.stack[this.ptr] }
  redo(): Snapshot | null { if (this.ptr >= this.stack.length - 1) return null; this.ptr++; return this.stack[this.ptr] }
  reset(s: Snapshot) { this.stack = [s]; this.ptr = 0 }
  get canUndo() { return this.ptr > 0 }
  get canRedo() { return this.ptr < this.stack.length - 1 }
}

// ── Search ────────────────────────────────────────────────────────────────────

interface SearchMatch { start: number; end: number; line: number; col: number }

function findMatches(text: string, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return []
  const matches: SearchMatch[] = []
  const src = caseSensitive ? text : text.toLowerCase()
  const q   = caseSensitive ? query : query.toLowerCase()
  let idx = 0
  while (true) {
    const pos = src.indexOf(q, idx); if (pos < 0) break
    const before = text.slice(0, pos); const lines = before.split('\n')
    matches.push({ start: pos, end: pos + q.length, line: lines.length, col: lines[lines.length-1].length })
    idx = pos + 1
  }
  return matches
}

// ── Completion kind icons ─────────────────────────────────────────────────────

const COMPLETION_KIND_META: Record<string, { label: string; color: string }> = {
  keyword:  { label: 'K', color: '#c084fc' },
  function: { label: 'ƒ', color: '#60a5fa' },
  method:   { label: 'm', color: '#34d399' },
  variable: { label: 'v', color: '#fbbf24' },
  type:     { label: 'T', color: '#f87171' },
  constant: { label: 'C', color: '#fb923c' },
  snippet:  { label: '✦', color: '#a3e635' },
  package:  { label: 'p', color: '#94a3b8' },
  field:    { label: 'f', color: '#fbbf24' },
}

function CompletionIcon({ kind }: { kind: CompletionItem['kind'] }) {
  const meta = COMPLETION_KIND_META[kind] ?? { label: '·', color: '#94a3b8' }
  return (
    <span
      className="w-[18px] h-[18px] rounded-sm flex items-center justify-center font-mono font-bold flex-shrink-0 text-[9px] select-none"
      style={{ background: `${meta.color}1a`, color: meta.color, border: `1px solid ${meta.color}33` }}
    >
      {meta.label}
    </span>
  )
}

// ── Completion dropdown ───────────────────────────────────────────────────────

function CompletionDropdown({
  items, activeIdx, x, y, maxH,
  onSelect, onHover,
}: {
  items: CompletionItem[]
  activeIdx: number
  x: number; y: number; maxH: number
  onSelect: (item: CompletionItem) => void
  onHover: (item: CompletionItem | null) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!items.length) return null
  const clampH = Math.min(maxH, 220)

  return (
    <div
      className="fixed z-50 rounded-lg border overflow-hidden"
      style={{
        left: x, top: y, width: 296, maxHeight: clampH,
        background: '#111114',
        borderColor: 'rgba(255,255,255,0.1)',
        boxShadow: '0 12px 48px rgba(0,0,0,.8), 0 2px 8px rgba(0,0,0,.4)',
      }}
    >
      <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: clampH }}>
        {items.map((item, i) => {
          const active = i === activeIdx
          const meta = COMPLETION_KIND_META[item.kind] ?? { label: '·', color: '#94a3b8' }
          return (
            <div
              key={i}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onHover(item)}
              onMouseLeave={() => onHover(null)}
              style={{
                background: active ? 'rgba(255,255,255,0.08)' : undefined,
                borderLeft: active ? `2px solid ${meta.color}` : '2px solid transparent',
              }}
              className="flex items-center gap-2 px-2 py-[5px] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-none"
            >
              <CompletionIcon kind={item.kind} />
              <span className="flex-1 min-w-0 text-[12px] text-[#e2e8f0] font-mono leading-none">{item.label}</span>
              {item.detail && (
                <span className="text-[10px] text-[#475569] font-mono truncate max-w-[80px] flex-shrink-0">
                  {item.detail.replace(/^func\s+\w+/, '').replace(/\(.*/, '(…)')}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {/* Footer */}
      <div className="px-2 py-1 border-t border-[rgba(255,255,255,0.06)] flex items-center gap-2">
        <span className="text-[9px] text-[#334155] font-mono">↑↓ navigate</span>
        <span className="text-[9px] text-[#334155] font-mono ml-auto">↵ select · Esc dismiss</span>
      </div>
    </div>
  )
}

// ── Completion detail panel ───────────────────────────────────────────────────

function CompletionDetail({ item, x, y }: { item: CompletionItem | null; x: number; y: number }) {
  if (!item || (!item.detail && !item.documentation)) return null
  return (
    <div
      className="fixed z-50 rounded-lg border p-3 pointer-events-none animate-fade-in"
      style={{
        left: x + 304, top: y, width: 232,
        background: '#111114',
        borderColor: 'rgba(255,255,255,0.1)',
        boxShadow: '0 12px 48px rgba(0,0,0,.8)',
      }}
    >
      {item.detail && (
        <div className="font-mono text-[11px] text-[#60a5fa] mb-2 break-all leading-relaxed">{item.detail}</div>
      )}
      {item.documentation && (
        <p className="text-[11px] text-[#94a3b8] leading-relaxed">{item.documentation}</p>
      )}
    </div>
  )
}

// ── Hover doc tooltip ─────────────────────────────────────────────────────────

function HoverDocTooltip({ doc, x, y }: { doc: HoverDoc; x: number; y: number }) {
  const safeX = typeof window !== 'undefined' ? Math.min(x + 14, window.innerWidth - 320) : x
  const safeY = Math.max(y - 8, 8)
  return (
    <div className="fixed z-50 pointer-events-none animate-fade-up" style={{ left: safeX, top: safeY, maxWidth: 340 }}>
      <div className="rounded-lg border flex flex-col overflow-hidden"
        style={{ background: '#0d0d10', borderColor: 'rgba(255,255,255,0.1)', boxShadow: '0 12px 48px rgba(0,0,0,.8)' }}>
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap px-3 pt-2.5 pb-1.5 border-b border-[rgba(255,255,255,0.06)]">
          <span className="text-[12px] font-mono font-semibold text-[#e2e8f0]">{doc.title}</span>
          {doc.tags?.map(t => (
            <span key={t} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}>{t}</span>
          ))}
        </div>
        {/* Signature block */}
        {doc.signature && (
          <pre className="text-[11px] font-mono text-[#94a3b8] bg-[rgba(255,255,255,0.03)] px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all m-0 border-b border-[rgba(255,255,255,0.06)]">{doc.signature}</pre>
        )}
        {/* Doc body */}
        <div className="px-3 py-2 flex flex-col gap-1.5">
          <p className="text-[11px] text-[#64748b] leading-relaxed">{doc.doc}</p>
          {doc.returns && (
            <p className="text-[10px] font-mono">
              <span style={{ color: '#f87171' }}>returns</span>
              <span style={{ color: '#94a3b8' }}> {doc.returns}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Signature help ────────────────────────────────────────────────────────────

function SignatureHelpWidget({ help, x, y }: { help: SignatureHelp; x: number; y: number }) {
  const safeX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 360) : x
  const safeY = y - 8  // appear above cursor line

  // Render the signature with the active param highlighted
  const buildLabel = () => {
    if (!help.params.length) return <span className="text-[var(--fg-muted)]">{help.label}</span>

    // Find active param span within the signature
    const sig = help.label
    const parts: React.ReactNode[] = []
    let remaining = sig
    let paramIdx = 0

    // Try to highlight the active param name in the signature
    for (let p = 0; p < help.params.length; p++) {
      const param = help.params[p]
      const searchStr = `${param.name}`
      const idx = remaining.indexOf(searchStr)
      if (idx === -1) continue
      parts.push(<span key={`pre${p}`} className="text-[var(--fg-muted)]">{remaining.slice(0, idx)}</span>)
      parts.push(
        <span key={`param${p}`}
          className="font-bold"
          style={{ color: p === help.activeParam ? '#e5c07b' : 'var(--fg-muted)' }}>
          {searchStr}
        </span>
      )
      remaining = remaining.slice(idx + searchStr.length)
      paramIdx = p
    }
    if (remaining) parts.push(<span key="rest" className="text-[var(--fg-muted)]">{remaining}</span>)
    return parts.length > 0 ? parts : <span className="text-[var(--fg-muted)]">{sig}</span>
  }

  const activeP = help.params[help.activeParam]

  return (
    <div
      className="fixed z-50 pointer-events-none animate-fade-up"
      style={{ left: safeX, top: safeY - 60, maxWidth: 400 }}
    >
      <div className="rounded-lg border px-3 py-2 shadow-2xl"
        style={{ background: 'var(--surface-3)', borderColor: '#ffffff18', boxShadow: '0 4px 20px rgba(0,0,0,.6)' }}>
        {/* Signature line */}
        <div className="text-[10px] font-mono flex flex-wrap gap-0">
          {buildLabel()}
        </div>
        {/* Active param docs */}
        {activeP && (
          <div className="mt-1.5 flex items-start gap-2 border-t border-[var(--border-subtle)] pt-1.5">
            <span className="text-[10px] font-mono" style={{ color: '#e5c07b' }}>
              {activeP.name}
              <span className="text-[var(--fg-faint)]">: {activeP.type}</span>
            </span>
            {activeP.doc && (
              <span className="text-[10px] text-[var(--fg-muted)]">— {activeP.doc}</span>
            )}
          </div>
        )}
        {/* Param counter */}
        {help.params.length > 1 && (
          <div className="text-[9px] text-[var(--fg-faint)] mt-1 font-mono">
            param {help.activeParam + 1}/{help.params.length}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inlay hints overlay ───────────────────────────────────────────────────────

// ── Measure actual text width for a given font ───────────────────────────────
let _measureCtx: CanvasRenderingContext2D | null = null
function measureTextWidth(text: string, fontSize: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.601
  if (!_measureCtx) {
    const canvas = document.createElement('canvas')
    _measureCtx = canvas.getContext('2d')
  }
  if (_measureCtx) {
    _measureCtx.font = `${fontSize}px "JetBrains Mono", Consolas, "Courier New", monospace`
    return _measureCtx.measureText(text).width
  }
  return text.length * fontSize * 0.601
}

function InlayHintsLayer({ hints, fontSize, scrollTop, scrollLeft, code }: {
  hints: InlayHint[]; fontSize: number; scrollTop: number; scrollLeft: number; code: string
}) {
  const lineH = Math.round(fontSize * 1.62)
  if (!hints.length) return null

  const lines = code.split('\n')

  return (
    <>
      {hints.map((h, i) => {
        // Measure actual pixel width of the text up to h.col on that line
        const lineText  = lines[h.line - 1] ?? ''
        const textBefore = lineText.slice(0, h.col)
        const measured  = measureTextWidth(textBefore, fontSize)
        // 16 = textarea left padding, 6 = visual gap between code and hint
        const left  = measured + 16 + 6 - scrollLeft
        const top   = (h.line - 1) * lineH + 12 - scrollTop
        const color = h.kind === 'type' ? '#56b6c2' : h.kind === 'return' ? '#98c379' : '#abb2bf'
        const label = h.label.trimStart()
        return (
          <div
            key={i}
            className="absolute pointer-events-none select-none font-mono"
            style={{
              top, left,
              fontSize: Math.max(fontSize - 3, 9),
              lineHeight: `${lineH}px`,
              color,
              opacity: 0.55,
              background: `${color}10`,
              borderRadius: 2,
              paddingLeft: 3,
              paddingRight: 3,
              whiteSpace: 'pre',
              zIndex: 3,
            }}
          >
            {label}
          </div>
        )
      })}
    </>
  )
}

// ── Diagnostic widgets ────────────────────────────────────────────────────────

// Precise wavy underline per diagnostic — uses d.col / d.endCol for pixel-exact positioning
function DiagUnderlines({ diags, fontSize, scrollTop, scrollLeft, code }: {
  diags: Diagnostic[]; fontSize: number; scrollTop: number; scrollLeft: number; code: string
}) {
  const lineH  = Math.round(fontSize * 1.62)
  const charW  = fontSize * 0.601
  const lines  = code.split('\n')
  if (!diags.length) return null

  const c = { error: '#f87171', warning: '#fbbf24', info: '#60a5fa' } as const
  const wave = (col: string) =>
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='3'%3E%3Cpath d='M0 2.5 Q2 0.5 4 2.5 Q6 4.5 8 2.5' stroke='${encodeURIComponent(col)}' stroke-width='1.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`

  // Dedup by line+sev — keep highest priority per (line, col) pair
  const rendered: React.ReactNode[] = []
  const seen = new Set<string>()

  for (const d of diags) {
    const lineText = lines[d.line - 1] ?? ''
    const startCol = Math.max(0, (d.col ?? 1) - 1)          // 0-based
    // Estimate end col: use endCol if provided, else find end of word at startCol
    let endCol: number
    if (d.endCol != null && d.endCol > startCol) {
      endCol = d.endCol
    } else {
      // Find the word boundary starting at startCol
      const rest = lineText.slice(startCol)
      const wordLen = rest.match(/^[\w.]+/)?.[0]?.length ?? Math.min(8, lineText.length - startCol)
      endCol = startCol + Math.max(wordLen, 2)
    }

    const key = `${d.line}:${startCol}:${d.severity}`
    if (seen.has(key)) continue
    seen.add(key)

    const left  = startCol * charW + 16    // 16px textarea padding
    const width = Math.max((endCol - startCol) * charW, 8)
    const top   = (d.line - 1) * lineH + lineH - 1 + 12

    rendered.push(
      <div key={key} className="absolute pointer-events-none"
        style={{
          left, top, width, height: 3,
          backgroundImage: wave(c[d.severity] ?? c.info),
          backgroundRepeat: 'repeat-x',
          backgroundSize: '8px 3px',
        }} />
    )
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ transform: `translate(-${scrollLeft}px, -${scrollTop}px)` }}>
      {rendered}
    </div>
  )
}

// Left gutter bar — 3px vertical strip at the left edge of the editor area, one per affected line
function DiagGutterBars({ diags, fontSize, scrollTop }: {
  diags: Diagnostic[]; fontSize: number; scrollTop: number
}) {
  const lineH = Math.round(fontSize * 1.62)
  if (!diags.length) return null

  // Keep highest-severity per line
  const map = new Map<number, 'error' | 'warning' | 'info'>()
  const p = { error: 3, warning: 2, info: 1 } as const
  for (const d of diags) {
    if (d.severity === 'info') continue
    const ex = map.get(d.line)
    if (!ex || p[d.severity] > p[ex as keyof typeof p]) map.set(d.line, d.severity)
  }
  if (!map.size) return null

  const c = { error: '#f87171', warning: '#fbbf24', info: '#60a5fa' } as const

  return (
    <div className="absolute top-0 left-0 pointer-events-none z-20" style={{ width: 3 }}>
      {Array.from(map.entries()).map(([line, sev]) => (
        <div key={line} style={{
          position: 'absolute',
          top: (line - 1) * lineH + 12 - scrollTop,
          height: lineH,
          width: 3,
          background: c[sev],
          opacity: 0.82,
          borderRadius: '0 1px 1px 0',
        }} />
      ))}
    </div>
  )
}

// Inline ghost text — right-aligned, faint code-style message after the line
function InlineGhostText({ diags, fontSize, scrollTop }: {
  diags: Diagnostic[]; fontSize: number; scrollTop: number
}) {
  const lineH = Math.round(fontSize * 1.62)
  const map = new Map<number, Diagnostic>()
  const p = { error: 2, warning: 1, info: 0 } as const
  for (const d of diags) {
    if (d.severity === 'info') continue
    const ex = map.get(d.line)
    if (!ex || p[d.severity] > p[ex.severity]) map.set(d.line, d)
  }
  if (!map.size) return null
  const styles = {
    error:   { color: 'rgba(248,113,113,0.55)',  icon: '✕' },
    warning: { color: 'rgba(251,191,36,0.55)',   icon: '⚠' },
    info:    { color: 'rgba(96,165,250,0.55)',   icon: 'ℹ' },
  } as const
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ transform: `translateY(-${scrollTop}px)` }}>
      {Array.from(map.entries()).map(([line, d]) => {
        const st = styles[d.severity]
        const msg = d.message.length > 52 ? d.message.slice(0, 50) + '…' : d.message
        return (
          <div key={line}
            className="absolute right-10 flex items-center gap-1.5 font-mono whitespace-nowrap select-none"
            style={{ top: (line - 1) * lineH + 12, height: lineH, fontSize: Math.max(fontSize - 2, 10), color: st.color, maxWidth: '38%' }}>
            <span style={{ fontSize: 9, opacity: 0.9 }}>{st.icon}</span>
            <span className="truncate italic" style={{ letterSpacing: '0.01em' }}>{msg}</span>
          </div>
        )
      })}
    </div>
  )
}

function DiagBadge({ diags }: { diags: Diagnostic[] }) {
  const errs  = diags.filter(d => d.severity === 'error').length
  const warns = diags.filter(d => d.severity === 'warning').length
  if (!errs && !warns) return null
  return (
    <div className="absolute bottom-3 right-4 z-10 flex items-center gap-1.5 select-none pointer-events-none">
      {errs  > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}>
          <span style={{ fontSize: 8 }}>✕</span> {errs}
        </span>
      )}
      {warns > 0 && (
        <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.22)' }}>
          <span style={{ fontSize: 8 }}>⚠</span> {warns}
        </span>
      )}
    </div>
  )
}

// ── Search bar ────────────────────────────────────────────────────────────────

function SearchBar({ query, setQuery, matchCount, matchIdx, caseSensitive, setCaseSensitive, onNext, onPrev, onClose }: {
  query: string; setQuery: (q: string) => void
  matchCount: number; matchIdx: number
  caseSensitive: boolean; setCaseSensitive: (v: boolean) => void
  onNext: () => void; onPrev: () => void; onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <div className="absolute top-2 right-4 z-30 flex items-center gap-1.5 rounded-lg border shadow-xl px-2 py-1.5"
      style={{ background: 'var(--surface-3)', borderColor: '#ffffff20', boxShadow: '0 4px 20px rgba(0,0,0,.5)', minWidth: 260 }}>
      <Search size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
      <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.shiftKey ? onPrev() : onNext(); return }
          if (e.key === 'Escape') { onClose(); return }
          e.stopPropagation()
        }}
        placeholder="Find in file…"
        className="flex-1 bg-transparent outline-none text-xs text-[var(--fg)] placeholder-[var(--fg-faint)] min-w-0"
        style={{ fontFamily: 'var(--font-mono)', color: (query && matchCount === 0) ? '#ef4444' : undefined }}
      />
      {query && <span className="text-[10px] text-[var(--fg-faint)] font-mono flex-shrink-0 select-none">{matchCount === 0 ? 'no results' : `${matchIdx + 1}/${matchCount}`}</span>}
      <button title="Case sensitive" onClick={() => setCaseSensitive(!caseSensitive)}
        className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold border-0 cursor-pointer transition-colors ${caseSensitive ? 'bg-[var(--active)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]'}`}>Aa</button>
      <button onClick={onPrev} disabled={matchCount === 0} className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer disabled:opacity-30"><ChevronUp size={11} /></button>
      <button onClick={onNext} disabled={matchCount === 0} className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer disabled:opacity-30"><ChevronDown size={11} /></button>
      <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer"><X size={11} /></button>
    </div>
  )
}

// ── Diag hover tip ────────────────────────────────────────────────────────────

function DiagTip({ diags, x, y, onInstall }: {
  diags: Diagnostic[]; x: number; y: number
  onInstall?: (lib: LibraryInfo & { importName: string }) => void
}) {
  if (!diags.length) return null
  const safeX = typeof window !== 'undefined' ? Math.min(x + 14, window.innerWidth - 380) : x
  const safeY = Math.max(y - 80, 8)
  return (
    <div className="fixed z-50 pointer-events-none max-w-sm animate-fade-up" style={{ left: safeX, top: safeY }}>
      <div className="rounded-lg border overflow-hidden"
        style={{ background: '#0d0d10', borderColor: 'rgba(255,255,255,0.1)', boxShadow: '0 12px 48px rgba(0,0,0,.8)' }}>
        {diags.slice(0, 3).map((d, i) => {
          const isErr  = d.severity === 'error'
          const isWarn = d.severity === 'warning'
          const col    = isErr ? '#f87171' : isWarn ? '#fbbf24' : '#60a5fa'
          const borderL = isErr ? '2px solid #f87171' : isWarn ? '2px solid #fbbf24' : '2px solid #60a5fa'
          // Extract T-code if present
          const tcode = d.message.match(/\[?(T\d{4})\]?/)?.[1]
          const msg = tcode ? d.message.replace(/\[?T\d{4}\]?\s*[:—\-]?\s*/, '') : d.message
          return (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2.5" style={{ borderLeft: borderL, borderBottom: i < diags.slice(0,3).length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
              <span style={{ color: col, fontSize: 11, marginTop: 1 }} className="flex-shrink-0 font-bold">
                {isErr ? '✕' : isWarn ? '⚠' : 'ℹ'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#e2e8f0] leading-relaxed break-words">{msg}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {tcode && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${col}18`, color: col, border: `1px solid ${col}30` }}>{tcode}</span>
                  )}
                  <span className="text-[9px] font-mono text-[#334155]">L{d.line}:{d.col}</span>
                  {d.quickFix && (
                    <span className="text-[9px] font-mono text-[#60a5fa]" style={{ background: 'rgba(96,165,250,0.1)', padding: '1px 5px', borderRadius: 3 }}>💡 {d.quickFix.label}</span>
                  )}
                  {d.missingLib && onInstall && (
                    <button onClick={() => onInstall(d.missingLib!)}
                      className="text-[9px] font-mono cursor-pointer border-0 pointer-events-auto transition-colors"
                      style={{ color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '1px 6px', borderRadius: 3 }}>
                      ↓ Install {d.missingLib.displayName}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatGo(code: string, tabSize: number): string {
  const tab = ' '.repeat(tabSize); let indent = 0
  return code.split('\n').map(raw => {
    const line = raw.trimEnd(); if (!line) return ''
    if (/^[\s]*[})\]]/.test(line)) indent = Math.max(0, indent - 1)
    const out = tab.repeat(indent) + line.trimStart()
    if (/[{([]$/.test(line.trimEnd())) indent++
    return out
  }).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
//  LINE NUMBERS + BREAKPOINT GUTTER
// ─────────────────────────────────────────────────────────────────────────────

function LineNumbers({ count, fontSize, errLines, warnLines, curLine, breakpointLines, onToggleBreakpoint }: {
  count: number; fontSize: number
  errLines: Set<number>; warnLines: Set<number>; curLine: number
  breakpointLines: Set<number>; onToggleBreakpoint: (line: number) => void
}) {
  const lineH = Math.round(fontSize * 1.62)
  return (
    <div className="select-none flex-shrink-0 flex" style={{ width: 66, paddingTop: 12, paddingBottom: 200 }}>
      {/* Breakpoint gutter — 14px */}
      <div style={{ width: 14, flexShrink: 0 }}>
        {Array.from({ length: count }, (_, i) => {
          const n = i + 1
          const hasBp = breakpointLines.has(n)
          return (
            <div
              key={i}
              title={hasBp ? `Remove breakpoint at line ${n}` : `Add breakpoint at line ${n}`}
              onClick={() => onToggleBreakpoint(n)}
              className="flex items-center justify-center cursor-pointer group"
              style={{ height: lineH, width: 14 }}
            >
              {hasBp ? (
                <span style={{ fontSize: 8, color: '#f87171', lineHeight: 1 }}>●</span>
              ) : (
                <span style={{ fontSize: 7, color: 'transparent', lineHeight: 1 }}
                  className="group-hover:!text-[rgba(248,113,113,0.4)] transition-colors">●</span>
              )}
            </div>
          )
        })}
      </div>
      {/* Line number column — 52px */}
      <div style={{ flex: 1 }}>
        {Array.from({ length: count }, (_, i) => {
          const n = i + 1
          const isE = errLines.has(n)
          const isW = !isE && warnLines.has(n)
          const isC = n === curLine
          const isBp = breakpointLines.has(n)
          return (
            <div key={i} className="font-mono pr-2 flex items-center justify-end gap-1"
              style={{
                fontSize, lineHeight: `${lineH}px`,
                background: isBp ? 'rgba(248,113,113,0.08)' : isC ? 'rgba(255,255,255,0.025)' : undefined,
              }}>
              {(isE || isW) && (
                <span style={{ fontSize: 7, lineHeight: 1, color: isE ? '#f87171' : '#fbbf24' }}>●</span>
              )}
              <span style={{
                color: isC ? 'var(--fg)' : isBp ? '#f87171' : isE ? '#f87171' : isW ? '#fbbf24' : 'var(--fg-faint)',
                fontWeight: isC ? '600' : undefined,
                opacity: (!isC && !isBp && !isE && !isW) ? 0.6 : undefined,
              }}>{n}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Indent guides ─────────────────────────────────────────────────────────────
// Draws faint vertical lines at each indent level, aligned to character grid.

function IndentGuides({ code, fontSize, tabSize, scrollTop, scrollLeft, curLine }: {
  code: string; fontSize: number; tabSize: number; scrollTop: number; scrollLeft: number; curLine: number
}) {
  const lineH   = Math.round(fontSize * 1.62)
  const charW   = fontSize * 0.601
  const indentW = tabSize * charW
  const lines   = code.split('\n')
  const totalH  = lines.length * lineH + 200

  const levels: number[] = lines.map(l => {
    const stripped = l.trimStart()
    if (!stripped) return -1
    return Math.floor((l.length - stripped.length) / tabSize)
  })

  for (let i = 0; i < levels.length; i++) {
    if (levels[i] !== -1) continue
    let next = 0
    for (let j = i + 1; j < levels.length; j++) { if (levels[j] !== -1) { next = levels[j]; break } }
    levels[i] = next
  }

  // The active indent column is the current line's level (1-based column index)
  const curLevel = levels[curLine - 1] ?? 0

  type Seg = { x: number; y1: number; y2: number; active: boolean }
  const segs: Seg[] = []

  const maxLevel = Math.max(...levels.filter(l => l >= 0), 0)
  for (let col = 1; col <= maxLevel; col++) {
    let inRun = false
    let runStart = 0
    let runHasCur = false
    for (let row = 0; row <= levels.length; row++) {
      const active = row < levels.length && levels[row] >= col
      if (active && !inRun) { inRun = true; runStart = row; runHasCur = false }
      if (active && inRun && row === curLine - 1) runHasCur = true
      if (!active && inRun) {
        inRun = false
        const x  = (col - 1) * indentW + 16
        const y1 = runStart * lineH + 12
        const y2 = row      * lineH + 12
        if (y2 - y1 > lineH) segs.push({ x, y1, y2, active: runHasCur && col === curLevel })
      }
    }
  }

  if (!segs.length) return null

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: '100%', height: totalH, transform: `translate(-${scrollLeft}px, -${scrollTop}px)`, overflow: 'visible', zIndex: 0 }}
    >
      {segs.map((s, i) => (
        <line key={i}
          x1={s.x} y1={s.y1} x2={s.x} y2={s.y2}
          stroke={s.active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.065)'}
          strokeWidth={s.active ? 1.5 : 1}
        />
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN EDITOR
// ─────────────────────────────────────────────────────────────────────────────

export default function CodeEditor() {
  const { openTabs, activeTabIdx, updateTabContent, saveFile, setProblems, settings, dispatchCommand, togglePackage, packages, updateSetting } = useStore()

  const tab       = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const hlRef     = useRef<HTMLDivElement>(null)
  const lnRef     = useRef<HTMLDivElement>(null)
  const lintTimer = useRef<ReturnType<typeof setTimeout>>()
  const compTimer = useRef<ReturnType<typeof setTimeout>>()

  const undoStacks = useRef<Map<string, UndoStack>>(new Map())
  function getStack(fileId: string): UndoStack {
    if (!undoStacks.current.has(fileId)) { const s = new UndoStack(); undoStacks.current.set(fileId, s); return s }
    return undoStacks.current.get(fileId)!
  }

  const content   = tab?.content ?? ''
  const lineCount = Math.max(content.split('\n').length, 1)
  const fontSize  = settings.fontSize
  const lineH     = Math.round(fontSize * 1.62)
  const tabSize   = settings.tabSize
  const charWidth = fontSize * 0.601

  // ── Breakpoints ────────────────────────────────────────────────────────────
  const bpFileId = tab?.fileId ?? ''
  const allBreakpoints = settings.breakpoints ?? {}
  const bpLines = new Set<number>(allBreakpoints[bpFileId] ?? [])
  function toggleBreakpoint(line: number) {
    const current = allBreakpoints[bpFileId] ?? []
    const next = current.includes(line)
      ? current.filter(l => l !== line)
      : [...current, line].sort((a, b) => a - b)
    updateSetting('breakpoints', { ...allBreakpoints, [bpFileId]: next })
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const [diags, setDiags]               = useState<Diagnostic[]>([])
  const [scrollTop, setScrollTop]       = useState(0)
  const [scrollLeft, setScrollLeft]     = useState(0)
  const [hoverLine, setHoverLine]       = useState<number | null>(null)
  const [tipPos, setTipPos]             = useState({ x: 0, y: 0 })
  const [showLibModal, setShowLibModal] = useState(false)
  const [pendingLibs, setPendingLibs]   = useState<Array<LibraryInfo & { importName: string }>>([])
  const [ghostEnabled, setGhostEnabled] = useState(true)
  const [curLine, setCurLine]           = useState(1)
  const [codeSerieVisible, setCodeSerieVisible] = useState(false)

  // Search
  const [searchOpen, setSearchOpen]         = useState(false)
  const [searchQuery, setSearchQuery]       = useState('')
  const [searchCase, setSearchCase]         = useState(false)
  const [searchMatchIdx, setSearchMatchIdx] = useState(0)
  const searchMatches = searchOpen && searchQuery ? findMatches(content, searchQuery, searchCase) : []

  // Completion
  const [completions, setCompletions]       = useState<CompletionItem[]>([])
  const [compIdx, setCompIdx]               = useState(0)
  const [compPos, setCompPos]               = useState({ x: 0, y: 0, maxH: 0 })
  const [hoveredComp, setHoveredComp]       = useState<CompletionItem | null>(null)
  const compVisible = completions.length > 0

  // Hover doc
  const [hoverDoc, setHoverDoc]             = useState<HoverDoc | null>(null)
  const [hoverDocPos, setHoverDocPos]       = useState({ x: 0, y: 0 })
  const hoverDocTimer                       = useRef<ReturnType<typeof setTimeout>>()

  // Signature help
  const [sigHelp, setSigHelp]               = useState<SignatureHelp | null>(null)
  const [sigPos, setSigPos]                 = useState({ x: 0, y: 0 })

  // Inlay hints
  const [inlayHints, setInlayHints]         = useState<InlayHint[]>([])

  const errLines     = new Set(diags.filter(d => d.severity === 'error').map(d => d.line))
  const warnLines    = new Set(diags.filter(d => d.severity === 'warning').map(d => d.line))
  const hoveredDiags = hoverLine != null ? diags.filter(d => d.line === hoverLine) : []

  const lspActive = !!(settings.experimentsEnabled && settings.expLspEnabled && settings.lspEnabled && settings.lspDiagnosticsEnabled)
  const featuresActive = lspActive

  // ── Build-file read-only guard ─────────────────────────────────────────────
  // Files inside build/ are generated artefacts (transpiled C++, object files,
  // linker output, etc.).  Opening them in full edit mode causes the LSP to fire
  // on auto-generated code and produce hundreds of spurious diagnostics.
  // We show a read-only view with a dismissible banner instead.
  const isBuildFile   = !!(tab?.buildFile)
  const buildReadOnly = isBuildFile && !settings.allowEditBuildFiles
  // Suppress ALL LSP features for build files regardless of the setting above —
  // generated code is never a valid LSP target.
  const lspEffective      = lspActive      && !isBuildFile
  const featuresEffective = featuresActive && !isBuildFile

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { setCodeSerieVisible(false) }, [tab?.fileId])

  useEffect(() => {
    if (!tab) return
    const stack = getStack(tab.fileId)
    const ta = taRef.current
    stack.push({ content: tab.content, selStart: ta?.selectionStart ?? 0, selEnd: ta?.selectionEnd ?? 0 })
  }, [tab?.fileId]) // eslint-disable-line

  useEffect(() => { setSearchOpen(false); setSearchQuery(''); setCompletions([]) }, [tab?.fileId])

  useEffect(() => {
    if (!tab) { setDiags([]); setProblems([]); return }
    clearTimeout(lintTimer.current)
    lintTimer.current = setTimeout(() => runLsp(tab.content, tab.ext ?? '', tab.name, tab.fileId), settings.lspDiagnosticDelay ?? 600)
    return () => clearTimeout(lintTimer.current)
  }, [tab?.fileId, lspEffective, packages]) // eslint-disable-line

  // Inlay hints refresh
  useEffect(() => {
    if (!featuresEffective || !settings.lspInlayHints || !tab) { setInlayHints([]); return }
    const timer = setTimeout(() => {
      const hints = getInlayHints(tab.content, tab.ext ?? '')
      setInlayHints(hints)
    }, 800)
    return () => clearTimeout(timer)
  }, [tab?.content, tab?.ext, featuresEffective, settings.lspInlayHints]) // eslint-disable-line

  // ── LSP ────────────────────────────────────────────────────────────────────

  function runLsp(code: string, ext: string, name: string, fileId: string) {
    if (!lspEffective) { setDiags([]); return }
    const installedPackages = new Set(packages.filter(p => p.installed).map(p => p.name.toLowerCase()))
    const result = runDiagnostics(code, name, ext, {
      lspGoEnabled:  settings.lspGoEnabled  ?? true,
      lspCppEnabled: settings.lspCppEnabled ?? true,
      lspInoEnabled: settings.lspInoEnabled ?? true,
      installedPackages,
      checkerLevel: (settings as any).checkerLevel ?? 'dev',
      lspMode: (settings as any).lspMode ?? 'hybrid',
    })
    setDiags(result); setProblems(result)
    if (!settings.lspShowLibPrompt) return
    const ignored = settings.lspIgnoredLibs ?? []
    const missing = getMissingLibDiags(result)
      .filter(d => { if (!d.missingLib) return false; const key = `${fileId}/${d.missingLib.importName}`; return !ignored.includes(d.missingLib.importName) && !_sessionPrompted.has(key) })
      .map(d => d.missingLib!).filter((lib, i, arr) => arr.findIndex(l => l.importName === lib.importName) === i)
    if (!missing.length) return
    missing.forEach(l => _sessionPrompted.add(`${fileId}/${l.importName}`))
    if (settings.lspAutoDownloadLibs) {
      missing.forEach(lib => {
        const tsuki = (settings.tsukiPath || 'tsuki').replace(/^"|"$/g, '')
        const args  = ['pkg', 'add', lib.packageId]
        const cmd   = `${tsuki} ${args.join(' ')}`
        dispatchCommand(tsuki, args, undefined)
      })
    } else { setPendingLibs(missing); setShowLibModal(true) }
  }

  // ── Cursor pixel position ─────────────────────────────────────────────────

  function getCursorPixelPos(ta: HTMLTextAreaElement): { x: number; y: number } | null {
    const before   = ta.value.slice(0, ta.selectionStart)
    const lines    = before.split('\n')
    const ln       = lines.length
    const col      = lines[lines.length - 1].length
    const rect     = ta.getBoundingClientRect()
    const x        = rect.left + 52 + col * charWidth + 16 - scrollLeft
    const y        = rect.top  + (ln - 1) * lineH + lineH + 12 - scrollTop
    return { x, y }
  }

  // ── Completions ───────────────────────────────────────────────────────────

  function triggerCompletion(ta: HTMLTextAreaElement, offset: number) {
    if (!featuresEffective || !settings.lspCompletionsEnabled) return
    const ext = tab?.ext ?? ''
    clearTimeout(compTimer.current)
    compTimer.current = setTimeout(() => {
      const items = getCompletions(ta.value, offset, ext)
      if (!items.length) { setCompletions([]); return }
      setCompletions(items)
      setCompIdx(0)
      const pos = getCursorPixelPos(ta)
      if (pos) {
        const maxH = window.innerHeight - pos.y - 16
        setCompPos({ x: Math.min(pos.x, window.innerWidth - 296), y: pos.y, maxH })
      }
    }, 80)
  }

  function applyCompletion(item: CompletionItem) {
    const ta = taRef.current; if (!ta || !tab) return
    const offset = ta.selectionStart
    const { word, start, end } = wordAtOffset(ta.value, offset)
    // For member access, include the word before `.`
    const before = ta.value.slice(0, start)
    const memberStart = before.match(/\w+\.$/) ? start - before.match(/\w+\./)![0].length : start
    const next = ta.value.slice(0, memberStart) + item.insertText + ta.value.slice(end)
    updateTabContent(activeTabIdx, next)
    pushUndo(next)
    const newPos = memberStart + item.insertText.length
    requestAnimationFrame(() => {
      if (taRef.current) { taRef.current.selectionStart = taRef.current.selectionEnd = newPos }
    })
    setCompletions([])
  }

  // ── Signature help trigger ────────────────────────────────────────────────

  function triggerSignatureHelp(ta: HTMLTextAreaElement) {
    if (!featuresEffective || !settings.lspSignatureHelp) return
    const ext  = tab?.ext ?? ''
    const help = getSignatureHelp(ta.value, ta.selectionStart, ext)
    setSigHelp(help)
    if (help) {
      const pos = getCursorPixelPos(ta)
      if (pos) setSigPos(pos)
    }
  }

  // ── Hover ─────────────────────────────────────────────────────────────────

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const line = Math.floor((e.clientY - rect.top + scrollTop - 12) / lineH) + 1
    setHoverLine(line); setTipPos({ x: e.clientX, y: e.clientY })

    if (!featuresEffective || !settings.lspHoverEnabled) return
    clearTimeout(hoverDocTimer.current)
    hoverDocTimer.current = setTimeout(() => {
      const ta = taRef.current; if (!ta) return
      // Compute character offset from mouse position
      const col     = Math.floor((e.clientX - rect.left - 16 + scrollLeft) / charWidth)
      const lines   = ta.value.split('\n')
      let offset    = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0) + Math.max(0, Math.min(col, (lines[line - 1] ?? '').length))
      const doc = getHoverDoc(ta.value, offset, tab?.ext ?? '')
      if (doc) { setHoverDoc(doc); setHoverDocPos({ x: e.clientX, y: e.clientY }) }
      else setHoverDoc(null)
    }, 400)
  }

  function onMouseLeave() {
    setHoverLine(null); clearTimeout(hoverDocTimer.current); setHoverDoc(null)
  }

  // ── Cursor update ─────────────────────────────────────────────────────────

  function updateCursor(ta: HTMLTextAreaElement) {
    const before = ta.value.slice(0, ta.selectionStart)
    const ls = before.split('\n'); const ln = ls.length; const col = ls[ls.length-1].length + 1
    setCurLine(ln); useStore.setState({ _cursor: `Ln ${ln}, Col ${col}` } as any)
  }

  // ── Undo helpers ──────────────────────────────────────────────────────────

  function applySnapshot(snap: Snapshot) {
    updateTabContent(activeTabIdx, snap.content)
    requestAnimationFrame(() => { if (taRef.current) { taRef.current.selectionStart = snap.selStart; taRef.current.selectionEnd = snap.selEnd } })
  }

  function pushUndo(c: string) {
    if (!tab) return
    const ta = taRef.current
    getStack(tab.fileId).push({ content: c, selStart: ta?.selectionStart ?? 0, selEnd: ta?.selectionEnd ?? 0 })
  }

  // ── Scroll sync ───────────────────────────────────────────────────────────

  function onScroll() {
    const ta = taRef.current, hl = hlRef.current, ln = lnRef.current
    if (!ta || !hl || !ln) return
    hl.style.transform = `translate(-${ta.scrollLeft}px, -${ta.scrollTop}px)`
    ln.style.transform = `translateY(-${ta.scrollTop}px)`
    setScrollTop(ta.scrollTop); setScrollLeft(ta.scrollLeft)
  }

  // ── Key handler ───────────────────────────────────────────────────────────

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta  = e.currentTarget
    const mod = e.metaKey || e.ctrlKey

    // ── Completion navigation ────────────────────────────────────────────
    if (compVisible) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); setCompIdx(i => Math.min(i + 1, completions.length - 1)); return }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setCompIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); applyCompletion(completions[compIdx]); return
      }
      if (e.key === 'Escape')     { setCompletions([]); return }
    }

    // ── Search ──────────────────────────────────────────────────────────
    if (mod && e.key === 'f') { e.preventDefault(); setSearchOpen(true); return }

    // ── Undo / Redo ──────────────────────────────────────────────────────
    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); if (!tab) return
      const snap = getStack(tab.fileId).undo(); if (snap) applySnapshot(snap); return
    }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); if (!tab) return
      const snap = getStack(tab.fileId).redo(); if (snap) applySnapshot(snap); return
    }

    // ── Tab ──────────────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault()
      const s = ta.selectionStart, en = ta.selectionEnd
      const next = ta.value.slice(0, s) + ' '.repeat(tabSize) + ta.value.slice(en)
      updateTabContent(activeTabIdx, next); pushUndo(next)
      requestAnimationFrame(() => { if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s + tabSize })
      return
    }

    // ── Auto-close ───────────────────────────────────────────────────────
    if (settings.autoCloseBrackets) {
      const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }
      if (pairs[e.key]) {
        const s = ta.selectionStart, en = ta.selectionEnd
        if (s === en) {
          e.preventDefault()
          const next = ta.value.slice(0, s) + e.key + pairs[e.key] + ta.value.slice(s)
          updateTabContent(activeTabIdx, next); pushUndo(next)
          requestAnimationFrame(() => { if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s + 1 })
          return
        }
        e.preventDefault()
        const next = ta.value.slice(0, s) + e.key + ta.value.slice(s, en) + pairs[e.key] + ta.value.slice(en)
        updateTabContent(activeTabIdx, next); pushUndo(next)
        requestAnimationFrame(() => { if (taRef.current) { taRef.current.selectionStart = s + 1; taRef.current.selectionEnd = en + 1 } })
        return
      }
      const closers = new Set([')', ']', '}', '"', "'"])
      if (closers.has(e.key) && ta.value[ta.selectionStart] === e.key) {
        e.preventDefault()
        requestAnimationFrame(() => { if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = ta.selectionStart + 1 })
        return
      }
    }

    // ── Enter: smart brace expansion + auto-indent ───────────────────────
    if (e.key === 'Enter') {
      e.preventDefault()
      const s   = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const lineStart   = val.lastIndexOf('\n', s - 1) + 1
      const currentLine = val.slice(lineStart, s)
      const indentMatch = currentLine.match(/^(\s*)/)
      const baseIndent  = indentMatch ? indentMatch[1] : ''

      // Smart brace expansion: cursor is directly between { and }
      // (possibly with spaces between them on the same line)
      // Result:
      //   {        →    {
      //   |}            |    ← cursor here, one tab deeper
      //   }             }   ← closing brace on its own line
      const charBefore = val[s - 1]
      const charAfter  = val[end]
      const OPEN  = new Set(['{', '[', '('])
      const CLOSE: Record<string, string> = { '{': '}', '[': ']', '(': ')' }

      if (OPEN.has(charBefore) && charAfter === CLOSE[charBefore]) {
        const innerIndent  = baseIndent + ' '.repeat(tabSize)
        const newLine      = '\n' + innerIndent
        const closingLine  = '\n' + baseIndent
        const next = val.slice(0, s) + newLine + val.slice(end)
        updateTabContent(activeTabIdx, next); pushUndo(next)
        // Put the closing brace on its own line after the inner content
        const insertAt = s + newLine.length
        const finalVal = next.slice(0, insertAt) + closingLine + next.slice(insertAt)
        updateTabContent(activeTabIdx, finalVal); pushUndo(finalVal)
        requestAnimationFrame(() => {
          if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = insertAt
        })
        return
      }

      // Normal Enter: auto-indent + extra level after opening brace
      let indent = baseIndent
      if (currentLine.trimEnd().endsWith('{') || currentLine.trimEnd().endsWith('[') || currentLine.trimEnd().endsWith('(')) {
        indent += ' '.repeat(tabSize)
      }
      const next = val.slice(0, s) + '\n' + indent + val.slice(end)
      updateTabContent(activeTabIdx, next); pushUndo(next)
      requestAnimationFrame(() => { if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s + 1 + indent.length })
      return
    }

    // ── Backspace ────────────────────────────────────────────────────────
    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      const s = ta.selectionStart
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1
      const beforeCursor = ta.value.slice(lineStart, s)
      if (beforeCursor && /^\s+$/.test(beforeCursor) && beforeCursor.length % tabSize === 0) {
        e.preventDefault()
        const next = ta.value.slice(0, s - tabSize) + ta.value.slice(s)
        updateTabContent(activeTabIdx, next); pushUndo(next)
        requestAnimationFrame(() => { if (taRef.current) taRef.current.selectionStart = taRef.current.selectionEnd = s - tabSize })
        return
      }
    }

    // ── Save ─────────────────────────────────────────────────────────────
    if (mod && e.key === 's') {
      e.preventDefault()
      let c = content
      if (tab?.ext === 'go' && settings.formatOnSave) { c = formatGo(c, tabSize); updateTabContent(activeTabIdx, c) }
      if (settings.trimWhitespace) { c = c.split('\n').map(l => l.trimEnd()).join('\n'); updateTabContent(activeTabIdx, c) }
      runLsp(c, tab?.ext ?? '', tab?.name ?? '', tab?.fileId ?? '')
      saveFile(activeTabIdx)
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    updateTabContent(activeTabIdx, next); pushUndo(next)
    clearTimeout(lintTimer.current)
    lintTimer.current = setTimeout(() => runLsp(next, tab?.ext ?? '', tab?.name ?? '', tab?.fileId ?? ''), settings.lspDiagnosticDelay ?? 600)
    // Trigger completions after a short delay
    triggerCompletion(e.target, e.target.selectionStart)
    // Trigger signature help
    triggerSignatureHelp(e.target)
  }

  function onKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    updateCursor(e.currentTarget)
    const ta = e.currentTarget
    // Dismiss completions on certain keys
    if (['Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      setCompletions([]); setSigHelp(null)
    }
    // Trigger signature help on ( or ,
    if (e.key === '(' || e.key === ',') triggerSignatureHelp(ta)
    if (e.key === ')') setSigHelp(null)
  }

  function onMouseUp(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    updateCursor(e.currentTarget); setCompletions([]); setSigHelp(null)
  }

  // ── Quick fix / Library ───────────────────────────────────────────────────

  function applyQuickFix(diag: Diagnostic) {
    if (!diag.quickFix) return
    const lines = content.split('\n'); lines[diag.line - 1] = diag.quickFix.newText
    const next = lines.join('\n'); updateTabContent(activeTabIdx, next); pushUndo(next)
  }

  async function handleInstall(lib: LibraryInfo & { importName: string }) {
    const tsuki = (settings.tsukiPath || 'tsuki').replace(/^\"|"$/g, '')
    const args  = ['pkg', 'add', lib.packageId]
    // dispatchCommand already switches bottomTab to 'output' — do NOT override it
    // with 'terminal' here or the user sees the terminal while output goes to Output tab.
    dispatchCommand(tsuki, args, undefined)
    togglePackage(lib.packageId)
  }

  function handleNeverAsk(importName: string) {
    if (tab?.fileId) _sessionPrompted.add(`${tab.fileId}/${importName}`)
    useStore.getState().updateSetting('lspIgnoredLibs', [...(settings.lspIgnoredLibs ?? []), importName])
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  function buildContextMenu(e: React.MouseEvent<HTMLTextAreaElement>) {
    const ta  = e.currentTarget
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd)
    const cl  = ta.value.slice(0, ta.selectionStart).split('\n').length
    const fixes = diags.filter(d => d.line === cl && d.quickFix).map(d => ({ label: `💡 ${d.quickFix!.label}`, action: () => applyQuickFix(d) }))
    const stack = tab ? getStack(tab.fileId) : null
    showContextMenu(e, [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !stack?.canUndo, action: () => { if (tab) { const sn = getStack(tab.fileId).undo(); if (sn) applySnapshot(sn) } } },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !stack?.canRedo, action: () => { if (tab) { const sn = getStack(tab.fileId).redo(); if (sn) applySnapshot(sn) } }, sep: false },
      { label: 'Cut',  shortcut: 'Ctrl+X', sep: true, disabled: !sel, action: () => { if (sel) navigator.clipboard.writeText(sel).catch(() => {}); document.execCommand('cut') } },
      { label: 'Copy', shortcut: 'Ctrl+C', disabled: !sel, action: () => navigator.clipboard.writeText(sel).catch(() => {}) },
      { label: 'Paste',shortcut: 'Ctrl+V', action: () => { navigator.clipboard.readText().then(t => { const s = ta.selectionStart, en = ta.selectionEnd; const next = ta.value.substring(0, s) + t + ta.value.substring(en); updateTabContent(activeTabIdx, next); pushUndo(next); requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + t.length }) }).catch(() => {}) } },
      { label: 'Select All', shortcut: 'Ctrl+A', sep: true, action: () => { ta.focus(); ta.select() } },
      { label: 'Find…',      shortcut: 'Ctrl+F', sep: true, action: () => setSearchOpen(true) },
      { label: 'Format Document', shortcut: 'Ctrl+Shift+F', sep: true, disabled: tab?.ext !== 'go',
        action: () => { if (tab?.ext === 'go') { const fmt = formatGo(content, settings.tabSize ?? 2); updateTabContent(activeTabIdx, fmt); pushUndo(fmt) } } },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => saveFile(activeTabIdx) },
      ...(lspEffective ? [{ label: ghostEnabled ? '🔇 Hide inline hints' : '💬 Show inline hints', sep: true, action: () => setGhostEnabled(v => !v) }] : []),
      ...fixes,
    ])
  }

  // ── Search navigation ─────────────────────────────────────────────────────

  function navigateToMatch(idx: number, matches: SearchMatch[]) {
    const ta = taRef.current; if (!ta || !matches.length) return
    const m = matches[idx]; ta.focus(); ta.selectionStart = m.start; ta.selectionEnd = m.end
    ta.scrollTop = Math.max(0, (m.line - 1) * lineH - 100); onScroll()
  }
  function searchNext() { if (!searchMatches.length) return; const next = (searchMatchIdx + 1) % searchMatches.length; setSearchMatchIdx(next); navigateToMatch(next, searchMatches) }
  function searchPrev() { if (!searchMatches.length) return; const prev = (searchMatchIdx - 1 + searchMatches.length) % searchMatches.length; setSearchMatchIdx(prev); navigateToMatch(prev, searchMatches) }
  useEffect(() => {
    setSearchMatchIdx(0)
    const m = findMatches(content, searchQuery, searchCase)
    if (m.length > 0) navigateToMatch(0, m)
  }, [searchQuery, searchCase]) // eslint-disable-line

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!tab) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--fg-faint)]">
      <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center">
        <span className="font-mono font-bold text-sm">go</span>
      </div>
      <p className="text-sm">Open a file to start editing</p>
      <p className="text-xs">Select a file from the Explorer</p>
    </div>
  )

  const highlighted = tab.ext
    ? highlightByExt(content, tab.ext)
    : content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const editorStyle = { fontSize, lineHeight: `${lineH}px`, fontFamily: 'var(--font-mono)' }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Lock overlay — código generado */}
      {isBuildFile && buildReadOnly && !codeSerieVisible && (
        <div className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ backdropFilter: 'blur(6px)', background: 'rgba(10,11,12,0.55)' }}>
          <div className="flex flex-col items-center gap-4 px-8 py-7 rounded-xl select-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>🔒</div>
            <div>
              <p className="text-[13px] font-semibold text-[var(--fg)] mb-1">Código serie</p>
              <p className="text-[11px] text-[var(--fg-muted)] leading-relaxed">
                Este archivo es generado automáticamente por tsuki. Editar código compilado puede romper el proyecto.
              </p>
            </div>
            <button
              onClick={() => setCodeSerieVisible(true)}
              className="px-4 py-1.5 rounded-md text-[11px] font-medium cursor-pointer border-0 transition-colors"
              style={{ background: 'var(--active)', color: 'var(--fg)' }}>
              Ver en modo lectura
            </button>
          </div>
        </div>
      )}

      {/* Read-only indicator when viewing */}
      {isBuildFile && buildReadOnly && codeSerieVisible && (
        <div className="flex items-center gap-2 px-3 py-1 flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.06)', borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          <span style={{ fontSize: 10 }}>🔒</span>
          <span style={{ fontSize: 10.5, color: 'rgba(245,158,11,0.7)' }}>Código generado — sólo lectura</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden bg-[var(--surface)]" style={editorStyle}>

        {/* Line numbers */}
        <div className="overflow-hidden flex-shrink-0 relative border-r border-[var(--border-subtle)]" style={{ width: 66 }}>
          <div ref={lnRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, willChange: 'transform' }}>
            <LineNumbers count={lineCount} fontSize={fontSize} errLines={errLines} warnLines={warnLines} curLine={curLine}
              breakpointLines={bpLines} onToggleBreakpoint={toggleBreakpoint} />
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 relative overflow-hidden" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>

          {/* Breakpoint line highlights */}
          {Array.from(bpLines).map(bpLine => (
            <div key={bpLine} className="absolute left-0 right-0 pointer-events-none z-0"
              style={{ top: (bpLine - 1) * lineH + 12 - scrollTop, height: lineH, background: 'rgba(239,68,68,0.08)', borderLeft: '2px solid rgba(239,68,68,0.4)' }} />
          ))}

          {/* Current line highlight */}
          <div className="absolute left-0 right-0 pointer-events-none z-0"
            style={{ top: (curLine - 1) * lineH + 12 - scrollTop, height: lineH, background: 'rgba(255,255,255,0.025)', borderLeft: '2px solid rgba(255,255,255,0.06)' }} />

          {/* Search highlights */}
          {searchOpen && searchMatches.map((m, i) => (
            <div key={i} className="absolute pointer-events-none" style={{
              top: (m.line - 1) * lineH + 12 - scrollTop + 2,
              left: m.col * charWidth + 16 - scrollLeft,
              width: (m.end - m.start) * charWidth, height: lineH - 4,
              background: i === searchMatchIdx ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.18)',
              border: `1px solid ${i === searchMatchIdx ? 'rgba(251,191,36,0.8)' : 'rgba(251,191,36,0.35)'}`,
              borderRadius: 2, zIndex: 1,
            }} />
          ))}

          {/* Indent guides */}
          {settings.showLineNumbers && (
            <IndentGuides code={content} fontSize={fontSize} tabSize={tabSize} scrollTop={scrollTop} scrollLeft={scrollLeft} curLine={curLine} />
          )}

          {/* Syntax highlight */}
          <div ref={hlRef} className="editor-highlight absolute top-0 left-0 pointer-events-none"
            style={{ ...editorStyle, willChange: 'transform', minWidth: '100%' }}
            dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />

          {/* LSP overlays */}
          {lspEffective && <DiagUnderlines diags={diags} fontSize={fontSize} scrollTop={scrollTop} scrollLeft={scrollLeft} code={content} />}
          {lspEffective && <DiagGutterBars diags={diags} fontSize={fontSize} scrollTop={scrollTop} />}
          {lspEffective && ghostEnabled && <InlineGhostText diags={diags} fontSize={fontSize} scrollTop={scrollTop} />}

          {/* Inlay hints */}
          {featuresEffective && settings.lspInlayHints && (
            <InlayHintsLayer hints={inlayHints} fontSize={fontSize} scrollTop={scrollTop} scrollLeft={scrollLeft} code={content} />
          )}

          {/* Textarea */}
          <textarea ref={taRef} value={content}
            onChange={buildReadOnly ? undefined : onChange}
            onKeyDown={buildReadOnly ? undefined : onKeyDown}
            onKeyUp={onKeyUp}
            onScroll={onScroll} onMouseUp={onMouseUp}
            onContextMenu={buildContextMenu}
            readOnly={buildReadOnly}
            className="editor-textarea" style={{ ...editorStyle, ...(buildReadOnly ? { cursor: 'default', opacity: 0.75 } : {}) }}
            spellCheck={false} autoCorrect="off" autoCapitalize="off" data-gramm="false" />

          {/* Search bar */}
          {searchOpen && (
            <SearchBar query={searchQuery} setQuery={setSearchQuery}
              matchCount={searchMatches.length} matchIdx={searchMatchIdx}
              caseSensitive={searchCase} setCaseSensitive={setSearchCase}
              onNext={searchNext} onPrev={searchPrev}
              onClose={() => { setSearchOpen(false); setSearchQuery(''); taRef.current?.focus() }} />
          )}

          {/* Diag hover */}
          {lspEffective && hoveredDiags.length > 0 && !hoverDoc && (
            <DiagTip diags={hoveredDiags} x={tipPos.x} y={tipPos.y}
              onInstall={lib => { setPendingLibs([lib]); setShowLibModal(true) }} />
          )}

          {/* Hover doc */}
          {featuresEffective && settings.lspHoverEnabled && hoverDoc && hoveredDiags.length === 0 && (
            <HoverDocTooltip doc={hoverDoc} x={hoverDocPos.x} y={hoverDocPos.y} />
          )}

          {lspEffective && <DiagBadge diags={diags} />}
        </div>

        {/* Minimap */}
        {settings.minimap && (
          <div className="w-24 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-hidden opacity-30 pointer-events-none"
            style={{ fontSize: 2, lineHeight: '3px', fontFamily: 'var(--font-mono)', padding: '8px 4px' }}
            dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </div>

      {/* Completions dropdown (portal) */}
      {featuresEffective && compVisible && (
        <CompletionDropdown
          items={completions} activeIdx={compIdx}
          x={compPos.x} y={compPos.y} maxH={compPos.maxH}
          onSelect={applyCompletion}
          onHover={setHoveredComp}
        />
      )}
      {featuresEffective && hoveredComp && (
        <CompletionDetail item={hoveredComp} x={compPos.x} y={compPos.y} />
      )}

      {/* Signature help (portal) */}
      {featuresEffective && settings.lspSignatureHelp && sigHelp && !compVisible && (
        <SignatureHelpWidget help={sigHelp} x={sigPos.x} y={sigPos.y} />
      )}

      {showLibModal && pendingLibs.length > 0 && (
        <LibraryInstallModal libs={pendingLibs}
          onInstall={handleInstall}
          onIgnore={name => { if (tab?.fileId) _sessionPrompted.add(`${tab.fileId}/${name}`); setPendingLibs(p => p.filter(l => l.importName !== name)) }}
          onNeverAsk={handleNeverAsk}
          onClose={() => setShowLibModal(false)}
          tsukiPath={settings.tsukiPath} />
      )}


    </>
  )
}