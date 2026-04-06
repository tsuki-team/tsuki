'use client'
import { useStore } from '@/lib/store'
import { useState, useEffect, useCallback } from 'react'
import {
  fetchBoardRegistry, resolvePlatforms,
  type ResolvedPlatform, type ResolvedBoard,
} from '@/lib/boardPackages'
import {
  CircuitBoard, Wifi, Cpu, Box,
  Download, Trash2, ChevronRight, Settings,
  RefreshCw, AlertCircle, Loader2, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import BoardInstallModal from '@/components/other/BoardInstallModal'
import type { BoardPlatform } from '@/lib/store'

// ── Icon helper ───────────────────────────────────────────────────────────────

function PlatformIcon({ icon, size = 13 }: { icon: ResolvedPlatform['icon']; size?: number }) {
  switch (icon) {
    case 'wifi':    return <Wifi         size={size} />
    case 'cpu':     return <Cpu          size={size} />
    case 'box':     return <Box          size={size} />
    default:        return <CircuitBoard size={size} />
  }
}

// ── Platform row ──────────────────────────────────────────────────────────────

function PlatformRow({
  platform,
  expanded,
  onToggle,
  onInstallBoard,
  onRemoveBoard,
}: {
  platform:      ResolvedPlatform
  expanded:      boolean
  onToggle:      () => void
  onInstallBoard: (board: ResolvedBoard) => void
  onRemoveBoard:  (boardId: string) => void
}) {
  const installedCount = platform.boards_detail.filter(b => b.installed).length

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-0">
      {/* Platform header row */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 transition-colors group',
        !expanded && 'hover:bg-[var(--hover)]',
      )}>
        {/* Status dot: green if any board installed */}
        <div className={clsx(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          platform.installed ? 'bg-[var(--ok)]' : 'bg-[var(--border)]',
        )} />

        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 border-0 bg-transparent cursor-pointer p-0 text-left"
        >
          <span className={clsx('flex-shrink-0 transition-colors', platform.installed ? 'text-[var(--fg-muted)]' : 'text-[var(--fg-faint)]')}>
            <PlatformIcon icon={platform.icon} size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium text-[var(--fg)] truncate">{platform.display_name}</span>
              {installedCount > 0 && (
                <span className="text-[9px] font-mono text-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_10%,transparent)] px-1 rounded flex-shrink-0">
                  {installedCount}/{platform.boards_detail.length} installed
                </span>
              )}
            </div>
            <div className="text-[10px] text-[var(--fg-faint)] font-mono">
              {platform.core_package || platform.id}
              {platform.size_mb > 0 && ` · ~${platform.size_mb} MB`}
            </div>
          </div>
          <ChevronRight
            size={10}
            className={clsx('text-[var(--fg-faint)] flex-shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        </button>
      </div>

      {/* Expanded: board list */}
      {expanded && (
        <div className="px-3 pb-2 bg-[var(--surface-1)] border-b border-[var(--border)] animate-fade-up">
          {/* Description */}
          <p className="text-[10px] text-[var(--fg-muted)] leading-relaxed pt-1.5 pb-2">
            {platform.description}
          </p>

          {/* Board rows */}
          <div className="rounded border border-[var(--border)] divide-y divide-[var(--border-subtle)] overflow-hidden">
            {platform.boards_detail.map(board => (
              <BoardRow
                key={board.id}
                board={board}
                onInstall={() => onInstallBoard(board)}
                onRemove={() => onRemoveBoard(board.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Board row (inside expanded platform) ──────────────────────────────────────

function BoardRow({
  board,
  onInstall,
  onRemove,
}: {
  board:     ResolvedBoard
  onInstall: () => void
  onRemove:  () => void
}) {
  const [removeConfirm, setRemoveConfirm] = useState(false)

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 group hover:bg-[var(--hover)] transition-colors">
      {/* Installed dot */}
      <div className={clsx(
        'w-1 h-1 rounded-full flex-shrink-0',
        board.installed ? 'bg-[var(--ok)]' : 'bg-[var(--border)]',
      )} />

      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-mono text-[var(--fg)]">{board.id}</span>
        {board.installed && (
          <span className="ml-1.5 text-[9px] text-[var(--ok)]">v{board.latest}</span>
        )}
      </div>

      {/* Action */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
        {board.installed ? (
          removeConfirm ? (
            <>
              <button
                onClick={() => { onRemove(); setRemoveConfirm(false) }}
                className="px-1.5 py-0.5 rounded text-[9px] text-[var(--err)] border border-[color-mix(in_srgb,var(--err)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)] bg-transparent cursor-pointer"
              >Remove</button>
              <button onClick={() => setRemoveConfirm(false)}
                className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer">
                <X size={9} />
              </button>
            </>
          ) : (
            <button onClick={() => setRemoveConfirm(true)}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)] border-0 bg-transparent cursor-pointer">
              <Trash2 size={9} />
            </button>
          )
        ) : (
          <button onClick={onInstall}
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer">
            <Download size={9} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function PlatformsSidebar() {
  const { settings, updateSetting, setScreen, setSettingsTab } = useStore()
  const installed: string[] = settings.installedBoardPkgs ?? []

  const [platforms,     setPlatforms]     = useState<ResolvedPlatform[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [expandedId,    setExpandedId]    = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<BoardPlatform | null>(null)

  // ── Fetch registry ──────────────────────────────────────────────────────────

  const loadRegistry = useCallback(async () => {
    setLoading(true)
    setError(null)

    const urls: string[] = [
      ...(settings.registryUrls ?? []),
      settings.registryUrl ?? '',
    ].filter(Boolean)

    if (urls.length === 0) {
      setError('No registry URL configured. Add one in Settings → Packages.')
      setLoading(false)
      return
    }

    let found = false
    for (const url of urls) {
      const registry = await fetchBoardRegistry(url)
      if (!registry) continue

      const resolved = resolvePlatforms(registry, installed)
      setPlatforms(resolved)
      found = true
      break
    }

    if (!found) {
      setError('Could not reach any registry URL. Check your connection or settings.')
    }
    setLoading(false)
  }, [settings.registryUrls, settings.registryUrl, installed.join(',')])

  useEffect(() => { loadRegistry() }, [loadRegistry])

  // ── Install / remove ────────────────────────────────────────────────────────

  function openInstallModal(board: ResolvedBoard) {
    // Build a BoardPlatform for the modal
    const bp: BoardPlatform = {
      id:          board.id,
      name:        board.id,
      version:     board.latest,
      description: board.description,
      author:      board.author,
      arch:        board.arch,
      category:    board.category,
      installed:   board.installed,
      url:         board.toml_url,
    }
    setInstallTarget(bp)
  }

  function onInstalled(p: BoardPlatform) {
    if (!installed.includes(p.id)) {
      updateSetting('installedBoardPkgs', [...installed, p.id])
    }
  }

  function onRemove(boardId: string) {
    updateSetting('installedBoardPkgs', installed.filter(i => i !== boardId))
  }

  const installedCount = platforms.reduce(
    (n, p) => n + p.boards_detail.filter(b => b.installed).length,
    0,
  )
  const totalBoards = platforms.reduce((n, p) => n + p.boards_detail.length, 0)

  return (
    <>
      <div className="flex flex-col h-full text-[var(--fg)] text-xs">

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
          <span className="font-semibold text-[10px] uppercase tracking-widest text-[var(--fg-faint)]">
            Platforms
          </span>
          <div className="flex items-center gap-0.5">
            {!loading && totalBoards > 0 && (
              <span className="text-[9px] font-mono text-[var(--fg-faint)] mr-1">
                {installedCount}/{totalBoards}
              </span>
            )}
            <button
              title="Reload registry"
              onClick={loadRegistry}
              disabled={loading}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              title="Platform settings"
              onClick={() => { setScreen('settings'); setSettingsTab('packages') }}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
            >
              <Settings size={11} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-[var(--fg-faint)] text-[10px]">
              <Loader2 size={12} className="animate-spin" /> Fetching registry…
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col gap-2 px-3 py-4">
              <div className="flex items-start gap-2 text-[10px] text-[var(--err)]">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => { setScreen('settings'); setSettingsTab('packages') }}
                className="self-start text-[10px] text-[var(--fg-faint)] underline hover:text-[var(--fg)] bg-transparent border-0 cursor-pointer p-0"
              >
                Open settings
              </button>
            </div>
          )}

          {!loading && !error && platforms.length === 0 && (
            <div className="px-3 py-4 text-[10px] text-[var(--fg-faint)]">
              No board platforms found in registry.
            </div>
          )}

          {!loading && !error && platforms.map(platform => (
            <PlatformRow
              key={platform.id}
              platform={platform}
              expanded={expandedId === platform.id}
              onToggle={() => setExpandedId(prev => prev === platform.id ? null : platform.id)}
              onInstallBoard={openInstallModal}
              onRemoveBoard={onRemove}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-[var(--border)] flex-shrink-0">
          <p className="text-[9px] text-[var(--fg-faint)] leading-relaxed">
            Board packages contain the toolchain + core needed to compile for each family.
            Data is read from the registry — nothing is assumed by the IDE.
          </p>
        </div>
      </div>

      {/* Install modal (popup) */}
      {installTarget && (
        <BoardInstallModal
          platform={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={p => { onInstalled(p); setInstallTarget(null) }}
        />
      )}
    </>
  )
}
