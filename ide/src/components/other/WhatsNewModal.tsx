'use client'
import { useState, useEffect } from 'react'
import { X, ArrowUpRight, ChevronRight, ArrowRight } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  type: 'feature' | 'improvement' | 'fix' | 'breaking'
  text: string
}

export interface WhatsNewModalProps {
  version: string
  entries: ChangelogEntry[]
  onClose: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
//  CSS
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
  @keyframes wn-bd   { from{opacity:0}                                         to{opacity:1}              }
  @keyframes wn-in   { from{opacity:0;transform:translateY(28px) scale(.95)}   to{opacity:1;transform:none} }
  @keyframes wn-up   { from{opacity:0;transform:translateY(12px)}              to{opacity:1;transform:none} }
  @keyframes wn-lr   { from{opacity:0;transform:translateX(-10px)}             to{opacity:1;transform:none} }
  @keyframes wn-pop  { from{opacity:0;transform:scale(.72)}                    to{opacity:1;transform:scale(1)} }
  @keyframes wn-glimmer {
    from { background-position:-500% center }
    to   { background-position: 500% center }
  }
  @keyframes wn-blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes wn-bounce { 0%,100%{transform:translateX(0)} 50%{transform:translateX(5px)} }
  @keyframes wn-scan {
    0%   { left:-35%; opacity:0 }
    8%   { opacity:1 }
    92%  { opacity:1 }
    100% { left:110%; opacity:0 }
  }
  @keyframes wn-beam {
    0%,100% { opacity:.35; transform:scaleX(.5) }
    50%     { opacity:1;   transform:scaleX(1) }
  }

  .wn-bd { animation: wn-bd 200ms ease both }
  .wn-in { animation: wn-in 400ms cubic-bezier(.12,1,.3,1) both }

  .wn-s1 { animation: wn-up 260ms ease both; animation-delay: 55ms  }
  .wn-s2 { animation: wn-up 260ms ease both; animation-delay: 105ms }
  .wn-s3 { animation: wn-up 260ms ease both; animation-delay: 148ms }
  .wn-s4 { animation: wn-up 260ms ease both; animation-delay: 186ms }
  .wn-s5 { animation: wn-up 260ms ease both; animation-delay: 218ms }
  .wn-s6 { animation: wn-up 260ms ease both; animation-delay: 246ms }

  /* go code lines */
  .wn-go  { animation: wn-lr 160ms ease both; overflow:hidden; white-space:nowrap }
  .wn-go:nth-child(1)  { animation-delay:160ms  }
  .wn-go:nth-child(2)  { animation-delay:260ms  }
  .wn-go:nth-child(3)  { animation-delay:348ms  }
  .wn-go:nth-child(4)  { animation-delay:424ms  }
  .wn-go:nth-child(5)  { animation-delay:492ms  }
  .wn-go:nth-child(6)  { animation-delay:552ms  }
  .wn-go:nth-child(7)  { animation-delay:606ms  }
  .wn-go:nth-child(8)  { animation-delay:654ms  }
  .wn-go:nth-child(9)  { animation-delay:696ms  }
  .wn-go:nth-child(10) { animation-delay:734ms  }
  .wn-go:nth-child(11) { animation-delay:768ms  }

  /* cpp lines appear after go finishes */
  .wn-cpp  { animation: wn-lr 160ms ease both; overflow:hidden; white-space:nowrap }
  .wn-cpp:nth-child(1)  { animation-delay:620ms  }
  .wn-cpp:nth-child(2)  { animation-delay:688ms  }
  .wn-cpp:nth-child(3)  { animation-delay:752ms  }
  .wn-cpp:nth-child(4)  { animation-delay:812ms  }
  .wn-cpp:nth-child(5)  { animation-delay:868ms  }
  .wn-cpp:nth-child(6)  { animation-delay:920ms  }
  .wn-cpp:nth-child(7)  { animation-delay:968ms  }
  .wn-cpp:nth-child(8)  { animation-delay:1012ms }
  .wn-cpp:nth-child(9)  { animation-delay:1052ms }
  .wn-cpp:nth-child(10) { animation-delay:1088ms }
  .wn-cpp:nth-child(11) { animation-delay:1122ms }

  /* board chips — spring pop */
  .wn-chip { animation: wn-pop 220ms cubic-bezier(.34,1.56,.64,1) both }
  .wn-chip:nth-child(1) { animation-delay:260ms }
  .wn-chip:nth-child(2) { animation-delay:320ms }
  .wn-chip:nth-child(3) { animation-delay:380ms }
  .wn-chip:nth-child(4) { animation-delay:440ms }
  .wn-chip:nth-child(5) { animation-delay:500ms }
  .wn-chip:nth-child(6) { animation-delay:560ms }

  /* pkg install lines */
  .wn-pkg { animation: wn-lr 170ms ease both }
  .wn-pkg:nth-child(1) { animation-delay:270ms  }
  .wn-pkg:nth-child(2) { animation-delay:490ms  }
  .wn-pkg:nth-child(3) { animation-delay:710ms  }
  .wn-pkg:nth-child(4) { animation-delay:930ms  }
  .wn-pkg:nth-child(5) { animation-delay:1150ms }
  .wn-pkg:nth-child(6) { animation-delay:1370ms }

  /* improvement items */
  .wn-imp { animation: wn-up 210ms ease both }
  .wn-imp:nth-child(1) { animation-delay:280ms }
  .wn-imp:nth-child(2) { animation-delay:330ms }
  .wn-imp:nth-child(3) { animation-delay:380ms }
  .wn-imp:nth-child(4) { animation-delay:430ms }

  /* version shimmer */
  .wn-glimmer {
    background: linear-gradient(90deg,#666 0%,#fff 28%,#ededed 50%,#666 100%);
    background-size: 500% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: wn-glimmer 7s linear 500ms both;
  }

  /* blinking cursor */
  .wn-cursor::after {
    content: '▊';
    animation: wn-blink 1s step-end infinite;
    color: #4ade80;
    margin-left: 1px;
  }

  /* transpiler arrow bounce */
  .wn-arrow-anim { animation: wn-bounce 1.8s ease-in-out 1.4s infinite }

  /* scan line on hero card */
  .wn-scan {
    position:absolute; top:0; bottom:0; width:28%;
    background:linear-gradient(90deg,transparent,rgba(74,222,128,.05),transparent);
    animation: wn-scan 4.2s ease-in-out 1.6s infinite;
    pointer-events:none;
  }

  /* pulsing top accent */
  .wn-beam { animation: wn-beam 3.5s ease-in-out 700ms infinite }

  .wn-btn { transition: opacity 120ms, transform 80ms }
  .wn-btn:hover  { opacity:.82; transform:translateY(-1px) }
  .wn-btn:active { transform:scale(.97) }

  .wn-link { transition: opacity 120ms }
  .wn-link:hover { opacity:.55 }

  .wn-card { transition: border-color 170ms, background 170ms }
  .wn-card:hover {
    border-color: rgba(255,255,255,.1);
    background: rgba(255,255,255,.035);
  }

  .wn-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.06) transparent;
  }
`

// ─────────────────────────────────────────────────────────────────────────────
//  Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const G    = '#4ade80'
const B    = '#60a5fa'
const Y    = '#fbbf24'
const V    = '#a78bfa'
const R    = '#f87171'
const DIM  = '#484848'
const MUTED= '#8c8c8c'
const FG   = '#ededed'
const FG2  = '#d4d4d4'
const FG3  = '#c8c8c8'
const FG4  = '#a0a0a0'
const MONO = 'IBM Plex Mono, Fira Code, monospace'
const SANS = 'IBM Plex Sans, system-ui, sans-serif'

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Token = { t: string; c: string }
type Line  = Token[]

function CodeLine({ tokens, cls }: { tokens: Line; cls: string }) {
  return (
    <div className={cls} style={{ lineHeight: 1.75 }}>
      {tokens.length === 0
        ? <span>&nbsp;</span>
        : tokens.map((tk, i) => <span key={i} style={{ color: tk.c }}>{tk.t}</span>)
      }
    </div>
  )
}

function SectionDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontFamily: MONO, fontSize: 10, color, opacity: .85, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
        {label}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CodeHero — animated transpilation demo
// ─────────────────────────────────────────────────────────────────────────────

function CodeHero() {
  const go: Line[] = [
    [{ t: 'package ', c: B   }, { t: 'main',        c: FG2 }],
    [],
    [{ t: 'import ',  c: B   }, { t: '"arduino"',   c: FG4 }],
    [],
    [{ t: 'func ',    c: B   }, { t: 'setup',       c: FG2 }, { t: '() {', c: FG }],
    [{ t: '  arduino.', c: FG2 }, { t: 'PinMode',   c: FG3 }, { t: '(13, OUTPUT)', c: FG }],
    [{ t: '}',        c: FG  }],
    [],
    [{ t: 'func ',    c: B   }, { t: 'loop',        c: FG2 }, { t: '() {', c: FG }],
    [{ t: '  arduino.', c: FG2 }, { t: 'DigitalWrite', c: FG3 }, { t: '(13, HIGH)', c: FG }],
    [{ t: '  arduino.', c: FG2 }, { t: 'Delay',     c: FG3 }, { t: '(500)', c: FG }],
  ]

  const cpp: Line[] = [
    [{ t: '// generated by tsuki', c: DIM }],
    [{ t: '#include ', c: DIM }, { t: '<Arduino.h>', c: MUTED }],
    [],
    [{ t: 'void ', c: MUTED }, { t: 'setup',   c: FG2 }, { t: '() {', c: FG }],
    [{ t: '  pinMode',    c: FG2 }, { t: '(13, OUTPUT);', c: FG }],
    [{ t: '}',            c: FG }],
    [],
    [{ t: 'void ', c: MUTED }, { t: 'loop',    c: FG2 }, { t: '() {', c: FG }],
    [{ t: '  digitalWrite', c: FG2 }, { t: '(13, HIGH);', c: FG }],
    [{ t: '  delay',      c: FG2 }, { t: '(500);', c: FG }],
    [{ t: '}',            c: FG }],
  ]

  const pane: React.CSSProperties = {
    flex: 1,
    background: 'rgba(0,0,0,.56)',
    border: '1px solid rgba(255,255,255,.05)',
    borderRadius: 8,
    padding: '10px 12px',
    fontFamily: MONO,
    fontSize: 11,
    minWidth: 0,
  }

  return (
    <div
      className="wn-s2 wn-card rounded-xl p-4 relative overflow-hidden"
      style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)' }}
    >
      <div className="wn-scan" />
      <SectionDot color={G} label="Transpilador Go → C++" />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* Go pane */}
        <div style={pane}>
          <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: DIM, marginBottom: 8 }}>
            main.go
          </div>
          {go.map((tokens, i) => <CodeLine key={i} tokens={tokens} cls="wn-go" />)}
        </div>

        {/* Arrow */}
        <div className="wn-arrow-anim" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, paddingTop: 22 }}>
          <div style={{ width: 1, height: 24, background: `linear-gradient(to bottom, transparent, ${G}55)` }} />
          <ArrowRight size={14} style={{ color: G }} />
          <div style={{ width: 1, height: 24, background: `linear-gradient(to top, transparent, ${G}55)` }} />
        </div>

        {/* C++ pane */}
        <div style={pane}>
          <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.14em', textTransform: 'uppercase', color: DIM, marginBottom: 8 }}>
            main.cpp
          </div>
          {cpp.map((tokens, i) => <CodeLine key={i} tokens={tokens} cls="wn-cpp" />)}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  BoardsCard
// ─────────────────────────────────────────────────────────────────────────────

function BoardsCard() {
  const boards = [
    { label: 'UNO',     sub: 'ATmega328P',  color: G },
    { label: 'NANO',    sub: 'ATmega328P',  color: G },
    { label: 'MEGA',    sub: 'ATmega2560',  color: G },
    { label: 'ESP32',   sub: 'Xtensa LX6',  color: B },
    { label: 'ESP8266', sub: 'ESP8266EX',   color: B },
    { label: 'PICO',    sub: 'RP2040',      color: Y },
  ]

  return (
    <div
      className="wn-s3 wn-card rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)' }}
    >
      <SectionDot color={B} label="Multi-board" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {boards.map(b => (
          <div
            key={b.label}
            className="wn-chip"
            style={{
              padding: '4px 9px',
              borderRadius: 6,
              background: `${b.color}10`,
              border: `1px solid ${b.color}28`,
              fontFamily: MONO,
              fontSize: 10.5,
              fontWeight: 500,
              color: b.color,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {b.label}
            <span style={{ fontSize: 8, opacity: .42, fontWeight: 400 }}>{b.sub}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 11, fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: '0.04em' }}>
        AVR · ESP · RP2040 · auto-detect USB
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  TsukilibCard
// ─────────────────────────────────────────────────────────────────────────────

function TsukilibCard() {
  const lines: { cmd: boolean; text: string }[] = [
    { cmd: true,  text: 'tsuki pkg install dht'     },
    { cmd: false, text: '✓ dht@1.0.0'              },
    { cmd: true,  text: 'tsuki pkg install ws2812'  },
    { cmd: false, text: '✓ ws2812@1.0.0'           },
    { cmd: true,  text: 'tsuki pkg install bmp280'  },
    { cmd: false, text: '✓ bmp280@1.0.0'           },
  ]

  return (
    <div
      className="wn-s3 wn-card rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)' }}
    >
      <SectionDot color={Y} label="tsukilib" />

      <div
        style={{
          background: 'rgba(0,0,0,.62)',
          border: '1px solid rgba(255,255,255,.05)',
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: MONO,
          fontSize: 10.5,
          lineHeight: 1.9,
          overflow: 'hidden',
        }}
      >
        {lines.map((l, i) =>
          l.cmd ? (
            <div key={i} className="wn-pkg">
              <span style={{ color: G, marginRight: 7 }}>$</span>
              <span style={{ color: MUTED }}>{l.text}</span>
            </div>
          ) : (
            <div key={i} className="wn-pkg">
              <span style={{ color: G, marginRight: 7 }}>✓</span>
              <span style={{ color: FG2 }}>{l.text.replace('✓ ', '')}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  IdeCard — mini IDE mockup
// ─────────────────────────────────────────────────────────────────────────────

function IdeCard() {
  const lines: Line[] = [
    [{ t: 'package ', c: B  }, { t: 'main',   c: FG2 }],
    [],
    [{ t: 'import ', c: B   }, { t: '"arduino"', c: FG4 }],
    [],
    [{ t: 'func ', c: B     }, { t: 'setup', c: FG2 }, { t: '() {', c: FG }],
    [{ t: '  PinMode', c: FG3 }, { t: '(13, OUTPUT)', c: FG }],
    [{ t: '}', c: FG }],
    [],
    [{ t: 'func ', c: B     }, { t: 'loop', c: FG2 }, { t: '() {', c: FG }],
  ]

  return (
    <div
      className="wn-s4 wn-card rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)' }}
    >
      <SectionDot color={V} label="Web IDE" />

      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.07)' }}>
        {/* Fake titlebar */}
        <div style={{
          height: 16,
          background: '#0e0e0e',
          display: 'flex', alignItems: 'center',
          padding: '0 8px', gap: 5,
          borderBottom: '1px solid rgba(255,255,255,.05)',
        }}>
          {[R, Y, G].map((c, i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: c, opacity: .65 }} />
          ))}
          <span style={{ fontFamily: MONO, fontSize: 7, color: DIM, marginLeft: 6, letterSpacing: '0.05em' }}>
            tsuki-ide — main.go
          </span>
        </div>

        {/* Body */}
        <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr', height: 86 }}>
          {/* Sidebar icons */}
          <div style={{
            background: '#0c0c0c',
            borderRight: '1px solid rgba(255,255,255,.04)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', paddingTop: 6, gap: 6,
          }}>
            {[V, 'rgba(255,255,255,.14)', 'rgba(255,255,255,.14)', 'rgba(255,255,255,.14)'].map((c, i) => (
              <span key={i} style={{ width: 9, height: 9, borderRadius: 2, background: c }} />
            ))}
          </div>

          {/* Editor */}
          <div style={{ background: '#090909', padding: '5px 8px', fontFamily: MONO, fontSize: 7.5, overflow: 'hidden' }}>
            {lines.map((tokens, i) => (
              <div key={i} style={{ lineHeight: 1.85 }}>
                {tokens.length === 0
                  ? <span>&nbsp;</span>
                  : tokens.map((tk, j) => <span key={j} style={{ color: tk.c }}>{tk.t}</span>)
                }
              </div>
            ))}
            <div className="wn-cursor" style={{ fontFamily: MONO, fontSize: 7.5 }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CheckCard — rich error traceback
// ─────────────────────────────────────────────────────────────────────────────

function CheckCard() {
  const row: React.CSSProperties = { fontFamily: MONO, fontSize: 9.5, lineHeight: 1.85, color: DIM }

  return (
    <div
      className="wn-s4 wn-card rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)' }}
    >
      <SectionDot color={R} label="tsuki check" />

      <div style={{ background: 'rgba(0,0,0,.62)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 8, padding: '9px 12px' }}>
        <div style={row}>╭─ <span style={{ color: MUTED }}>Traceback</span> ─────────────────╮</div>
        <div style={row}>│  src/<span style={{ color: FG2 }}>main.go</span>:<span style={{ color: Y }}>14</span> in <span style={{ color: FG2 }}>main</span>          │</div>
        <div style={row}>│                                     │</div>
        <div style={row}>│ <span style={{ color: R }}>❱</span> <span style={{ color: DIM }}>14 │</span> <span style={{ color: FG }}>Delay(1000)</span><span style={{ color: DIM }}>              │</span></div>
        <div style={row}>│                                     │</div>
        <div style={row}>│ <span style={{ color: MUTED }}>did you mean </span><span style={{ color: G }}>arduino.Delay</span><span style={{ color: DIM }}>?      │</span></div>
        <div style={row}>╰─────────────────────────────────────╯</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main modal
// ─────────────────────────────────────────────────────────────────────────────

export default function WhatsNewModal({ version, entries, onClose }: WhatsNewModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const improvements = entries.filter(e => e.type === 'improvement')

  return (
    <>
      <style>{CSS}</style>

      {/* Backdrop */}
      <div
        className="wn-bd fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(8px)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        {/* Card */}
        <div
          className="wn-in relative flex flex-col"
          style={{
            width: 'clamp(320px, 96vw, 672px)',
            maxWidth: '96vw',
            maxHeight: 'min(91vh, 760px)',
            borderRadius: 16,
            overflow: 'hidden',
            background: '#07090b',
            border: '1px solid rgba(255,255,255,.075)',
            boxShadow: '0 52px 160px rgba(0,0,0,.85), 0 0 0 .5px rgba(255,255,255,.04) inset',
            fontFamily: SANS,
          }}
        >
          {/* Pulsing gradient top line */}
          <div
            className="wn-beam flex-shrink-0"
            style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent 0%, #4ade80 22%, #60a5fa 58%, #a78bfa 80%, transparent 100%)',
            }}
          />

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="wn-s1 flex-shrink-0" style={{ padding: '22px 26px 18px' }}>
            {/* Close button */}
            <button
              onClick={onClose}
              className="wn-btn absolute top-4 right-4 flex items-center justify-center"
              style={{
                width: 26, height: 26, borderRadius: '50%',
                background: 'rgba(255,255,255,.07)',
                color: 'rgba(255,255,255,.32)',
                border: 0, cursor: 'pointer',
              }}
            >
              <X size={12} />
            </button>

            {/* Badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 20, marginBottom: 13,
              background: `${G}0f`, border: `1px solid ${G}28`,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: G, display: 'inline-block' }} />
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: G, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Primera versión estable
              </span>
            </div>

            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: 'rgba(255,255,255,.88)' }}>
                What's New
              </h2>
              <span className="wn-glimmer" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em' }}>
                v{version}
              </span>
            </div>

            {/* Tagline */}
            <p style={{ margin: '6px 0 0', fontFamily: MONO, fontSize: 11, color: `${G}90`, letterSpacing: '0.04em' }}>
              Write in Go · Upload in C++
            </p>
          </div>

          {/* ── Scrollable body ────────────────────────────────────────────── */}
          <div
            className="wn-scroll flex-1 overflow-y-auto"
            style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 14 }}
          >
            {/* Transpiler hero */}
            <CodeHero />

            {/* 2×2 feature grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <BoardsCard />
              <TsukilibCard />
              <IdeCard />
              <CheckCard />
            </div>

            {/* Improvements */}
            {improvements.length > 0 && (
              <div className="wn-s5">
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DIM, marginBottom: 9, paddingLeft: 2 }}>
                  Mejoras adicionales
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {improvements.map((e, i) => (
                    <div
                      key={i}
                      className="wn-imp"
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 11px', borderRadius: 8,
                        background: 'rgba(255,255,255,.02)',
                        border: '1px solid rgba(255,255,255,.05)',
                      }}
                    >
                      <span style={{ color: B, flexShrink: 0, marginTop: 1, fontSize: 11 }}>↳</span>
                      <span style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55 }}>{e.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div
            className="wn-s6 flex-shrink-0 flex items-center justify-between"
            style={{
              padding: '11px 20px',
              borderTop: '1px solid rgba(255,255,255,.05)',
              background: 'rgba(0,0,0,.28)',
            }}
          >
            <a
              href="https://tsuki.sh/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="wn-link flex items-center gap-1"
              style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,.2)', textDecoration: 'none' }}
            >
              Changelog completo <ArrowUpRight size={10} />
            </a>

            <button
              onClick={onClose}
              className="wn-btn flex items-center gap-2"
              style={{
                padding: '8px 20px', borderRadius: 9,
                background: FG, color: '#0a0a0a',
                fontFamily: SANS, fontSize: 13, fontWeight: 600,
                border: 0, cursor: 'pointer',
              }}
            >
              Empezar <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}