'use client'
/**
 * IdeScreen — pantalla principal del IDE tsuki.
 *
 * Arquitectura:
 *  · AppChrome         — barra superior unificada (Tauri drag-region + controles de ventana)
 *  · WorkstationBar    — barra inferior estilo DaVinci (Code / Sandbox / Export)
 *  · StatusBar         — franja de 20px en el fondo (branch, cursor, board, errores)
 *  · SidebarIconBar    — activity bar de 40px con tabs de sidebar
 *  · Panel lateral     — Files / Packages / Examples / Explorer / Git
 *  · Área central      — CodeWorkstation / SandboxWorkstation / ComingSoonWorkstation
 */

import { useStore }           from '@/lib/store'
import { useState, useEffect, useRef } from 'react'
import dynamic                from 'next/dynamic'
import { clsx }               from 'clsx'
import { AppChrome }          from '@/components/shared/AppChrome'
import NewProjectModal        from '@/components/other/NewProjectModal'
import PortSelectModal, { type PortSelectOutcome } from '@/components/other/PortSelectModal'
import FilesSidebar           from '@/components/other/FilesSidebar'
import PackagesSidebar        from '@/components/other/PackagesSidebar'
import ExamplesSidebar        from '@/components/other/ExamplesSidebar'
import PlatformsSidebar       from '@/components/other/PlatformsSidebar'
import CodeEditor             from '@/components/other/CodeEditor'
import MigrationModal, { applyMigrations } from '@/components/other/MigrationModal'
import { showContextMenu }    from '@/components/shared/ContextMenu'
import {
  Files, GitBranch, Package, BookOpen,
  Code2, Cpu, Share2, ChevronRight, X, AlertTriangle,
  Copy, Save, FolderOpen, RefreshCw, Settings, Terminal,
} from 'lucide-react'
import type { ElementType } from 'react'

// ── Dynamic imports (SSR-safe) ────────────────────────────────────────────────

const BottomPanel       = dynamic(() => import('@/components/other/BottomPanel'),                                 { ssr: false })
const GitSidebar        = dynamic(() => import('@/components/experiments/GitSidebar/GitSidebar'),                 { ssr: false })
const SandboxPanel      = dynamic(() => import('@/components/experiments/SandboxPanel/SandboxPanel'),             { ssr: false })
const WebkitPanel       = dynamic(() => import('@/components/experiments/WebKitPanel/WebKitPanel'),               { ssr: false })
// ExportWorkstation removed — replaced by ComingSoonWorkstation

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const BOARDS = [
  // ── AVR ───────────────────────────────────────────────────
  'uno',          // Arduino Uno  (ATmega328P)
  'nano',         // Arduino Nano (ATmega328P)
  'mega',         // Arduino Mega 2560
  // ── ESP ───────────────────────────────────────────────────
  'esp32',        // ESP32 Dev Module
  'esp8266',      // ESP8266 Generic
  // ── RP2040 ────────────────────────────────────────────────
  'pico',         // Raspberry Pi Pico
]

// Boards that exist in the backend but are hidden from the public selector.
// Kept here so projects created with these boards still work.
const HIDDEN_BOARDS = [
  'nano_old', 'leonardo', 'micro', 'pro_mini_5v', 'pro_mini_3v3', 'due',
  'esp32s2', 'esp32c3', 'd1_mini', 'nodemcu',
]

// Boards with partial/experimental support. Mapped to a warning message shown
// in the IDE banner when the project targets that board.
const EXPERIMENTAL_BOARDS: Record<string, string> = {
  pico:    'El soporte para Raspberry Pi Pico (RP2040) es experimental. Algunas funciones pueden no estar disponibles.',
  esp32s2: 'El soporte para ESP32-S2 es experimental y puede presentar errores de compilación.',
  esp32c3: 'El soporte para ESP32-C3 es experimental y puede presentar errores de compilación.',
}

// ─────────────────────────────────────────────────────────────────────────────
//  Workstation type
// ─────────────────────────────────────────────────────────────────────────────

type Workstation = 'code' | 'sandbox' | 'export'

const WORKSTATIONS: { id: Workstation; label: string; Icon: ElementType; shortcut: string }[] = [
  { id: 'code',    label: 'Code',    Icon: Code2,  shortcut: '1' },
  { id: 'sandbox', label: 'Sandbox', Icon: Cpu,    shortcut: '2' },
  { id: 'export',  label: 'Export',  Icon: Share2, shortcut: '3' },
]

// ─────────────────────────────────────────────────────────────────────────────
//  IdeScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function IdeScreen() {
  const {
    projectName, projectPath, projectLanguage,
    board, setBoard, backend, setBackend, gitBranch, problems,
    theme, toggleTheme, setScreen,
    sidebarOpen, sidebarTab, toggleSidebar,
    openTabs, activeTabIdx, closeTab, openFile,
    tree, saveActiveFile, dispatchBuild, dispatchCommand, setBottomTab,
    settings, updateSetting, addLog,
    pendingCircuit, clearPendingCircuit,
    pendingMigrations, clearPendingMigrations,
  } = useStore()

  const [showNewProject, setShowNewProject] = useState(false)
  const [workstation,    setWorkstation]    = useState<Workstation>('code')
  const [sandboxOpen,    setSandboxOpen]    = useState(false)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const [showPortSelect,  setShowPortSelect]  = useState(false)
  // Stores the action to run once the user picks a port: 'flash' | 'run'
  const pendingFlashAction = useRef<'flash' | 'run'>('flash')
  // Live sidebar width tracked in a ref during drag — avoids React re-renders
  // and settings persistence on every mouse-move pixel.
  const sidebarWidthRef = useRef<number>(settings.sidebarWidth)

  // ── Experiment flags ──────────────────────────────────────────────────────

  const expEnabled          = settings.experimentsEnabled
  const sandboxEnabled      = expEnabled && settings.expSandboxEnabled
  const gitEnabled          = expEnabled && settings.expGitEnabled
  const workstationsEnabled = expEnabled && settings.expWorkstationsEnabled
  const webkitEnabled       = expEnabled && (settings as any).expWebkitEnabled

  // ── Auto-navigate to sandbox when a circuit is dispatched ─────────────────

  useEffect(() => {
    if (!pendingCircuit) return
    clearPendingCircuit()
    if (workstationsEnabled) {
      setWorkstation('sandbox')
    } else if (sandboxEnabled) {
      setSandboxOpen(true)
    }
  }, [pendingCircuit?.id]) // eslint-disable-line

  // ── Active tab helpers ────────────────────────────────────────────────────

  const activeTab  = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null
  const activeNode = activeTab ? tree.find(n => n.id === activeTab.fileId) : null
  const parentNode = activeNode
    ? tree.find(p => p.type === 'dir' && p.children?.includes(activeNode.id) && p.id !== 'root')
    : null

  // ── tsuki binary ─────────────────────────────────────────────────────────

  const tsukiBin = () => (settings.tsukiPath?.trim() || 'tsuki').replace(/^\"|\"$/g, '')

  // ── Build actions ─────────────────────────────────────────────────────────

  function handleCheck() {
    if (!projectPath) { addLog('warn', 'No project path — cannot check'); return }
    const args = ['check', '--board', board]
    if (settings.verbose) args.push('--verbose')
    dispatchBuild(tsukiBin(), args, projectPath)
  }

  function handleBuild() {
    if (!projectPath) { addLog('warn', 'No project path — cannot build'); return }
    const args = ['build', '--compile', '--board', board]
    if (settings.verbose) args.push('--verbose')
    dispatchBuild(tsukiBin(), args, projectPath)
  }

  function handleFlash() {
    if (!projectPath) { addLog('warn', 'No project path — cannot flash'); return }
    pendingFlashAction.current = 'flash'
    setShowPortSelect(true)
  }

  function handleRun() {
    if (!projectPath) { addLog('warn', 'No project path'); return }
    pendingFlashAction.current = 'run'
    setShowPortSelect(true)
  }

  function onPortSelected(outcome: PortSelectOutcome) {
    setShowPortSelect(false)
    if (outcome.cancel) return
    const port = outcome.port
    if (pendingFlashAction.current === 'flash') {
      const args = ['upload', '--board', board, '--port', port]
      if (settings.verbose) args.push('--verbose')
      dispatchBuild(tsukiBin(), args, projectPath ?? undefined)
    } else {
      const buildArgs  = ['build', '--compile', '--board', board]
      const uploadArgs = ['upload', '--board', board, '--port', port]
      if (settings.verbose) buildArgs.push('--verbose')
      dispatchBuild(tsukiBin(), buildArgs, projectPath ?? undefined, uploadArgs)
    }
  }

  function handleMonitor() {
    setBottomTab('monitor')
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 's' && !e.shiftKey) { e.preventDefault(); saveActiveFile(); if (settings.compileOnSave) handleBuild(); return }
      if (e.key === 'b' && !e.shiftKey) { e.preventDefault(); handleRun();     return }
      if (e.key === 'B' && e.shiftKey)  { e.preventDefault(); handleBuild();   return }
      if (e.key === 'T' && e.shiftKey)  { e.preventDefault(); handleCheck();   return }
      if (e.key === 'U' && e.shiftKey)  { e.preventDefault(); handleFlash();   return }
      if (e.key === 'm' && !e.shiftKey) { e.preventDefault(); handleMonitor(); return }
      if (workstationsEnabled) {
        if (e.key === '1') { setWorkstation('code');    return }
        if (e.key === '2') { setWorkstation('sandbox'); return }
        if (e.key === '3') { setWorkstation('export');  return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tsukiBin, board, projectPath, settings.verbose, settings.compileOnSave, workstationsEnabled]) // eslint-disable-line

  // ── Init: detect tsuki binary ─────────────────────────────────────────────

  useEffect(() => {
    addLog('info', `IDE ready · project: ${projectName || '(none)'} · board: ${board} · lang: ${projectLanguage}`)
    addLog('info', `Experiments: sandbox=${sandboxEnabled} git=${gitEnabled}`)
    const current = settings.tsukiPath?.trim()
    const isAbsolute = current?.includes('\\') || current?.includes('/')
    if (!isAbsolute) {
      addLog('info', 'Detecting tsuki binary in PATH…')
      import('@/lib/tauri').then(({ detectTool }) => {
        detectTool('tsuki')
          .then(resolved => {
            useStore.getState().updateSetting('tsukiPath', resolved)
            useStore.getState().addLog('ok', `tsuki found: ${resolved}`)
          })
          .catch(() => {
            useStore.getState().addLog('warn', 'tsuki not found in PATH. Go to Settings → CLI Tools.')
          })
      })
    }
  }, []) // eslint-disable-line

  // ── Sidebar resize ────────────────────────────────────────────────────────
  // We mutate the DOM directly during drag so React never re-renders on every
  // pixel, then commit the final value to the store only on mouseUp.  This
  // removes the jank caused by updating settings (→ persistence) on each event.

  useEffect(() => {
    if (!resizingSidebar) return

    // Keep the ref in sync with the current stored width when a drag starts.
    sidebarWidthRef.current = settings.sidebarWidth

    // Prevent text selection and iframe pointer-capture during the drag.
    document.body.style.userSelect = 'none'
    document.body.style.cursor     = 'col-resize'

    function onMove(e: MouseEvent) {
      const newW = Math.max(140, Math.min(480, e.clientX - 40))
      sidebarWidthRef.current = newW
      // Apply directly to the DOM — zero React involvement, zero persistence.
      const el = document.getElementById('tsuki-sidebar')
      if (el) el.style.width = newW + 'px'
    }

    function onUp() {
      document.body.style.userSelect = ''
      document.body.style.cursor     = ''
      setResizingSidebar(false)
      // Persist only once, when the user releases the mouse button.
      updateSetting('sidebarWidth', sidebarWidthRef.current)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor     = ''
    }
  }, [resizingSidebar]) // eslint-disable-line

  // ── Adaptive sidebar ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!settings.adaptiveSidebar) return
    const threshold = settings.minWindowWidth ?? 1024
    function check() {
      if (window.innerWidth < threshold) useStore.setState({ sidebarOpen: false })
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [settings.adaptiveSidebar, settings.minWindowWidth]) // eslint-disable-line

  // ── Sidebar tab definitions ───────────────────────────────────────────────

  const sidebarTabs = [
    { id: 'files',    icon: <Files size={15} />,      label: 'Files' },
    { id: 'packages',  icon: <Package size={15} />,    label: 'Packages'  },
    { id: 'platforms', icon: <Cpu size={15} />,       label: 'Platforms' },
    { id: 'examples',  icon: <BookOpen size={15} />,  label: 'Examples'  },
    ...(gitEnabled
      ? [{ id: 'git', icon: <GitBranch size={15} />, label: 'Git' }]
      : []),
  ]

  function renderSidebarContent() {
    switch (sidebarTab) {
      case 'files':    return <FilesSidebar />
      case 'packages':  return <PackagesSidebar />
      case 'platforms': return <PlatformsSidebar />
      case 'examples':  return <ExamplesSidebar />
      case 'git':      return gitEnabled ? <GitSidebar /> : null
      default:         return null
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--surface)] text-[var(--fg)]">

      {/* ── Chrome / top bar ── */}
      <AppChrome
        projectName={projectName}
        projectPath={projectPath || undefined}
        projectLanguage={projectLanguage}
        board={board}
        boards={BOARDS}
        onBoardChange={setBoard}
        onCheck={handleCheck}
        onBuild={handleBuild}
        onFlash={handleFlash}
        onRun={handleRun}
        onMonitor={handleMonitor}
        theme={theme}
        onTheme={toggleTheme}
        onSettings={() => setScreen('settings')}
        onHome={() => setScreen('welcome')}
        onNew={() => setShowNewProject(true)}
        sandboxEnabled={sandboxEnabled}
        workstationsEnabled={workstationsEnabled}
        sandboxOpen={sandboxOpen}
        onSandboxToggle={() => setSandboxOpen(o => !o)}
      />

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Activity bar */}
        <div
          className="flex flex-col items-center py-1.5 gap-0.5 border-r border-[var(--border)] flex-shrink-0"
          style={{ width: 40, background: 'var(--surface-1)' }}
        >
          {sidebarTabs.map(({ id, icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => toggleSidebar(id as any)}
              className={clsx(
                'w-8 h-8 flex items-center justify-center rounded cursor-pointer border-0 transition-colors relative',
                sidebarOpen && sidebarTab === id
                  ? 'text-[var(--fg)]'
                  : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
              )}
            >
              {sidebarOpen && sidebarTab === id && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--fg)] rounded-r" />
              )}
              {icon}
            </button>
          ))}
        </div>

        {/* Left sidebar */}
        <div
          id="tsuki-sidebar"
          className={clsx(
            'flex-shrink-0 flex flex-col overflow-hidden border-r border-[var(--border)]',
            sidebarOpen ? '' : 'w-0',
            // Only animate open/close transitions, not drag-resize (the drag
            // writes width directly to the DOM via the ref, bypassing React).
            !resizingSidebar && 'transition-[width] duration-150',
          )}
          style={sidebarOpen ? { width: settings.sidebarWidth, background: 'var(--surface-1)' } : {}}
        >
          {sidebarOpen && renderSidebarContent()}
        </div>

        {/* Sidebar resize handle */}
        {sidebarOpen && (
          <div
            className="w-[3px] bg-transparent hover:bg-[var(--fg-faint)] cursor-col-resize flex-shrink-0 transition-colors"
            onMouseDown={() => setResizingSidebar(true)}
            title="Drag to resize sidebar"
          >
            <div className={clsx('w-full h-full transition-colors', resizingSidebar && 'bg-[var(--fg-faint)]')} />
          </div>
        )}

        {/* ── Main content area ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Experimental board warning banner */}
          {board && EXPERIMENTAL_BOARDS[board] && (
            <div className="flex items-start gap-2 px-3 py-2 flex-shrink-0"
              style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.25)' }}>
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
              <p className="text-[11px] leading-snug flex-1" style={{ color: '#fbbf24' }}>
                <span className="font-semibold">Soporte experimental:</span>{' '}
                {EXPERIMENTAL_BOARDS[board]}
              </p>
            </div>
          )}

          {workstationsEnabled ? (
            /* ── Workstation mode ── */
            <>
              {/* Code workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'code' && 'hidden')}>
                <div className="flex-1 flex overflow-hidden min-h-0">
                  <CodeWorkstation
                    openTabs={openTabs}
                    activeTabIdx={activeTabIdx}
                    activeNode={activeNode}
                    parentNode={parentNode}
                    projectName={projectName}
                    openFile={openFile}
                    closeTab={closeTab}
                    saveActiveFile={saveActiveFile}
                  />

                  {/* WebKit side panel */}
                  {webkitEnabled && (
                    <div className="flex-shrink-0 border-l border-[var(--border)]" style={{ width: 360 }}>
                      <WebkitPanel />
                    </div>
                  )}
                </div>
                <BottomPanel />
              </div>

              {/* Sandbox workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'sandbox' && 'hidden')}>
                <SandboxWorkstation sandboxEnabled={sandboxEnabled} />
              </div>

              {/* Export workstation — Coming Soon */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0 items-center justify-center', workstation !== 'export' && 'hidden')}>
                <ComingSoonWorkstation />
              </div>
            </>
          ) : (
            /* ── Legacy layout (no workstations experiment) ── */
            <>
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Editor column */}
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <EditorTabBar
                    openTabs={openTabs}
                    activeTabIdx={activeTabIdx}
                    activeNode={activeNode}
                    parentNode={parentNode}
                    projectName={projectName}
                    openFile={openFile}
                    closeTab={closeTab}
                    saveActiveFile={saveActiveFile}
                  />
                  <div className="flex-1 flex overflow-hidden">
                    {openTabs.length === 0 ? <EmptyEditor /> : <CodeEditor />}
                  </div>
                </div>

                {/* WebKit panel */}
                {webkitEnabled && (
                  <div className="flex-shrink-0 border-l border-[var(--border)]" style={{ width: 360 }}>
                    <WebkitPanel />
                  </div>
                )}

                {/* Sandbox side panel */}
                {sandboxEnabled && sandboxOpen && (
                  <>
                    <div
                      className="w-[3px] bg-[var(--border)] hover:bg-[var(--fg-faint)] cursor-col-resize flex-shrink-0 transition-colors"
                    />
                    <div className="flex flex-col border-l border-[var(--border)] bg-[var(--surface)] flex-shrink-0 overflow-hidden" style={{ width: 480 }}>
                      <SandboxPanel onClose={() => setSandboxOpen(false)} />
                    </div>
                  </>
                )}
              </div>
              <BottomPanel />
            </>
          )}
        </div>
      </div>

      {/* ── Workstation bar (DaVinci-style) — solo cuando experiment está activo ── */}
      {workstationsEnabled && (
        <WorkstationBar active={workstation} onSelect={setWorkstation} />
      )}

      <StatusBar tsuki={tsukiBin()} />

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} />
      )}

      {showPortSelect && (
        <PortSelectModal onResult={onPortSelected} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ComingSoonWorkstation — placeholder until Export is implemented
// ─────────────────────────────────────────────────────────────────────────────

function ComingSoonWorkstation() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 select-none" style={{ background: 'var(--surface)' }}>
      <div
        className="flex items-center justify-center rounded-2xl border border-[var(--border)]"
        style={{ width: 56, height: 56, background: 'var(--surface-2)' }}
      >
        <Share2 size={24} style={{ color: 'var(--fg-faint)' }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Coming soon</p>
        <p className="text-xs mt-1" style={{ color: 'var(--fg-faint)' }}>
          Export is not available yet. Stay tuned.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  WorkstationBar
// ─────────────────────────────────────────────────────────────────────────────

function WorkstationBar({
  active, onSelect,
}: {
  active: Workstation
  onSelect: (w: Workstation) => void
}) {
  return (
    <div
      className="flex items-center justify-center border-t border-[var(--border)] flex-shrink-0 select-none px-2"
      style={{ height: 36, background: 'var(--surface-2)' }}
    >
      <div
        className="flex items-center gap-px rounded-lg overflow-hidden border border-[var(--border)]"
        style={{ background: 'var(--surface-3)' }}
      >
        {WORKSTATIONS.map((ws, i) => (
          <button
            key={ws.id}
            onClick={() => onSelect(ws.id)}
            title={`${ws.label} (Ctrl+${ws.shortcut})`}
            className={clsx(
              'flex items-center gap-1.5 px-4 h-7 cursor-pointer border-0 relative transition-all',
              active === ws.id
                ? 'text-[var(--fg)]'
                : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
              i > 0 && active !== ws.id && active !== WORKSTATIONS[i - 1].id
                && 'border-l border-[var(--border)]',
            )}
            style={{
              background: active === ws.id ? 'var(--surface-1)' : 'transparent',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.07em',
            }}
          >
            <ws.Icon size={12} />
            <span className="uppercase tracking-[0.07em]">{ws.label}</span>
            {active === ws.id && (
              <span
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                style={{ background: 'var(--fg)' }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CodeWorkstation
// ─────────────────────────────────────────────────────────────────────────────

function CodeWorkstation({ openTabs, activeTabIdx, activeNode, parentNode, projectName, openFile, closeTab, saveActiveFile }: any) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <EditorTabBar
        openTabs={openTabs}
        activeTabIdx={activeTabIdx}
        activeNode={activeNode}
        parentNode={parentNode}
        projectName={projectName}
        openFile={openFile}
        closeTab={closeTab}
        saveActiveFile={saveActiveFile}
      />
      <div className="flex-1 flex overflow-hidden">
        {openTabs.length === 0 ? <EmptyEditor /> : <CodeEditor />}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  EditorTabBar — tab bar + breadcrumb, reutilizado en legacy y workstation
// ─────────────────────────────────────────────────────────────────────────────

function EditorTabBar({ openTabs, activeTabIdx, activeNode, parentNode, projectName, openFile, closeTab, saveActiveFile }: any) {
  return (
    <>
      <div
        className="flex items-end h-8 border-b border-[var(--border)] overflow-x-auto flex-shrink-0 gap-0.5 px-1 pt-1"
        style={{ background: 'var(--surface-1)', scrollbarWidth: 'none' }}
      >
        {openTabs.length === 0 ? (
          <span className="px-4 text-xs text-[var(--fg-faint)] self-center">No files open</span>
        ) : openTabs.map((tab: any, i: number) => (
          <div
            key={tab.fileId}
            onClick={() => openFile(tab.fileId)}
            onContextMenu={(e: React.MouseEvent) => showContextMenu(e, [
              { label: 'Close tab',    action: () => closeTab(i) },
              { label: 'Copy filename', action: () => navigator.clipboard.writeText(tab.name).catch(() => {}), sep: true },
              { label: 'Save',         shortcut: 'Ctrl+S', action: () => saveActiveFile() },
            ])}
            className={clsx(
              'flex items-center gap-1.5 px-3 h-full rounded-t border-t cursor-pointer text-xs font-medium transition-colors flex-shrink-0 group',
              i === activeTabIdx
                ? 'bg-[var(--surface)] border-[var(--border)] border-x text-[var(--fg)]'
                : 'bg-transparent border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            )}
          >
            {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)] group-hover:hidden" />}
            <span className="truncate" style={{ maxWidth: 160 }}>{tab.name}</span>
            <button
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); closeTab(i) }}
              className="w-4 h-4 flex items-center justify-center rounded transition-colors border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--active)] opacity-0 group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Breadcrumb */}
      {activeNode && (
        <div
          className="h-6 flex items-center px-3 gap-1 border-b border-[var(--border-subtle)] text-xs text-[var(--fg-muted)] flex-shrink-0"
          style={{ background: 'var(--surface)' }}
          onContextMenu={(e: React.MouseEvent) => showContextMenu(e, [
            { label: 'Copy path', icon: <Copy size={11} />, action: () => navigator.clipboard.writeText(activeNode.path || activeNode.name).catch(() => {}) },
            { label: 'Copy filename', icon: <Copy size={11} />, action: () => navigator.clipboard.writeText(activeNode.name).catch(() => {}) },
            { label: 'Save file', icon: <Save size={11} />, shortcut: 'Ctrl+S', sep: true, action: () => saveActiveFile() },
          ])}
        >
          <span>{projectName}</span>
          {parentNode && (
            <><ChevronRight size={10} className="text-[var(--fg-faint)]" /><span>{parentNode.name}</span></>
          )}
          <ChevronRight size={10} className="text-[var(--fg-faint)]" />
          <span className="text-[var(--fg)]">{activeNode.name}</span>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  EmptyEditor placeholder
// ─────────────────────────────────────────────────────────────────────────────

function EmptyEditor() {
  const { setScreen, setBottomTab } = useStore()
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-3 select-none text-[var(--fg-faint)]"
      onContextMenu={(e: React.MouseEvent) => showContextMenu(e, [
        { label: 'Open file', icon: <FolderOpen size={11} />, action: () => {} },
        { label: 'Open terminal', icon: <Terminal size={11} />, action: () => setBottomTab('terminal') },
        { label: 'Settings', icon: <Settings size={11} />, sep: true, action: () => setScreen('settings') },
      ])}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity={0.2}>
        <rect x="6" y="4" width="28" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <line x1="12" y1="13" x2="28" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="12" y1="19" x2="24" y2="19" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="12" y1="25" x2="20" y2="25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <p className="text-xs">Select a file to start editing</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  SandboxWorkstation — panel de simulación con code drawer colapsable
// ─────────────────────────────────────────────────────────────────────────────

function SandboxWorkstation({ sandboxEnabled }: { sandboxEnabled: boolean }) {
  const { openTabs, activeTabIdx, problems } = useStore()
  const [codeOpen,   setCodeOpen]   = useState(false)
  const [codeHeight, setCodeHeight] = useState(220)
  const draggingRef = useRef(false)
  const startYRef   = useRef(0)
  const startHRef   = useRef(0)

  const activeTab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return
      const delta = startYRef.current - e.clientY
      setCodeHeight(Math.max(80, Math.min(520, startHRef.current + delta)))
    }
    function onUp() {
      draggingRef.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  if (!sandboxEnabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--fg-faint)]">
        <Cpu size={32} className="opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium text-[var(--fg-muted)]">Sandbox no activado</p>
          <p className="text-xs mt-1">
            Activa el experimento <strong className="text-[var(--fg-muted)]">Sandbox</strong> en Settings → Experiments.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* SandboxPanel ocupa el espacio disponible */}
      <div className="flex-1 overflow-hidden min-h-0">
        <SandboxPanel fullscreen />
      </div>

      {/* ── Code drawer colapsable ── */}
      <div
        className="flex-shrink-0 border-t border-[var(--border)] relative"
        style={{ background: 'var(--surface-1)' }}
      >
        {/* Resize grip — visible solo cuando el drawer está abierto */}
        {codeOpen && (
          <div
            className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-10 hover:bg-[var(--fg-faint)] transition-colors"
            onMouseDown={e => {
              e.stopPropagation()
              draggingRef.current = true
              startYRef.current   = e.clientY
              startHRef.current   = codeHeight
              document.body.style.cursor     = 'row-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}

        {/* Header */}
        <div
          className="h-7 flex items-center gap-2 px-3 select-none cursor-pointer hover:bg-[var(--hover)] transition-colors"
          onClick={() => setCodeOpen(o => !o)}
        >
          <ChevronRight
            size={11}
            className="text-[var(--fg-faint)] transition-transform flex-shrink-0"
            style={{ transform: codeOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
          <Code2 size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
          <span
            className="flex-1"
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}
          >
            Code
          </span>
          {/* Checker error/warning badges */}
          {problems.filter(p => p.severity === 'error').length > 0 && (
            <span
              className="flex items-center gap-1 px-1.5 rounded text-[9px] font-semibold"
              style={{ background: 'color-mix(in srgb, #ef4444 15%, var(--surface-3))', color: '#ef4444' }}
            >
              {problems.filter(p => p.severity === 'error').length} error{problems.filter(p => p.severity === 'error').length !== 1 ? 's' : ''}
            </span>
          )}
          {problems.filter(p => p.severity === 'warning').length > 0 && (
            <span
              className="flex items-center gap-1 px-1.5 rounded text-[9px] font-semibold"
              style={{ background: 'color-mix(in srgb, #f59e0b 15%, var(--surface-3))', color: '#f59e0b' }}
            >
              {problems.filter(p => p.severity === 'warning').length} warn
            </span>
          )}
          {activeTab ? (
            <span className="text-[10px] font-mono text-[var(--fg-muted)] truncate" style={{ maxWidth: 200 }}>
              {activeTab.name}
              {activeTab.modified && <span className="ml-1 text-[var(--fg-faint)]">●</span>}
            </span>
          ) : (
            <span className="text-[10px] italic text-[var(--fg-faint)]">no file open</span>
          )}
        </div>

        {/* Code content */}
        {codeOpen && (
          <div
            className="overflow-auto border-t border-[var(--border)]"
            style={{ height: codeHeight, scrollbarWidth: 'thin' }}
          >
            {/* Checker diagnostics panel — shown when there are problems */}
            {problems.length > 0 && (
              <div className="border-b border-[var(--border)]" style={{ background: 'var(--surface-2)' }}>
                {problems.map(p => (
                  <div
                    key={p.id}
                    className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--border)] last:border-b-0"
                    style={{ background: p.severity === 'error' ? 'color-mix(in srgb, #ef4444 6%, var(--surface-2))' : p.severity === 'warning' ? 'color-mix(in srgb, #f59e0b 6%, var(--surface-2))' : 'var(--surface-2)' }}
                  >
                    <span
                      className="flex-shrink-0 mt-px text-[9px] font-bold uppercase tracking-wide"
                      style={{ color: p.severity === 'error' ? '#ef4444' : p.severity === 'warning' ? '#f59e0b' : 'var(--fg-muted)', minWidth: 36 }}
                    >
                      {p.severity === 'error' ? 'ERR' : p.severity === 'warning' ? 'WARN' : 'INFO'}
                    </span>
                    <span className="font-mono text-[10px] leading-4" style={{ color: 'var(--fg-muted)', minWidth: 52 }}>
                      {p.file}:{p.line}:{p.col}
                    </span>
                    <span className="text-[11px] leading-4 flex-1" style={{ color: 'var(--fg)' }}>
                      {p.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activeTab ? (
              <pre
                className="p-3 text-xs leading-5 text-[var(--fg-muted)] whitespace-pre min-h-full m-0"
                style={{ fontFamily: 'var(--font-mono, "IBM Plex Mono", monospace)' }}
              >
                {activeTab.content || <span className="text-[var(--fg-faint)] italic">empty file</span>}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-xs italic text-[var(--fg-faint)]">
                Open a file in the editor to preview it here
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  StatusBar
// ─────────────────────────────────────────────────────────────────────────────

function StatusBar({ tsuki }: { tsuki: string }) {
  const { board, backend, gitBranch, openTabs, activeTabIdx, problems } = useStore()
  const [cursor, setCursor] = useState('Ln 1, Col 1')

  useEffect(() => {
    const id = setInterval(() => {
      const c = (window as any).__gdi_cursor
      if (c) setCursor(c)
    }, 300)
    return () => clearInterval(id)
  }, [])

  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length
  const activeTab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null

  return (
    <div
      className="flex items-center px-3 gap-3 border-t border-[var(--border)] flex-shrink-0 select-none"
      style={{ height: 20, background: 'var(--surface-2)' }}
    >
      <div className="flex items-center gap-3 font-mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>
        <span className="flex items-center gap-1">
          <GitBranch size={9} /> {gitBranch || 'main'}
        </span>
        {(errCount + warnCount) > 0 ? (
          <span className="flex items-center gap-1.5">
            {errCount  > 0 && <span style={{ color: 'var(--err)' }}>✗ {errCount}</span>}
            {warnCount > 0 && <span style={{ color: 'var(--warn)' }}>⚠ {warnCount}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ok)' }} />
            <span style={{ color: 'var(--ok)' }}>月</span>
            <span>ready</span>
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 font-mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>
        <span>{tsuki}</span>
        {backend && <span>{backend}</span>}
        <span>board: {board}</span>
        {activeTab && <span>{activeTab.ext || 'go'}</span>}
        <span>{cursor}</span>
      </div>
    </div>
  )
}