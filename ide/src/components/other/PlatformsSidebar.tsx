'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  PlatformsSidebar — Browse and install board platform packages
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import { useStore }         from '@/lib/store'
import type { BoardPlatform } from '@/lib/store'
import {
  Cpu, Search, RefreshCw, CheckCircle2, Download,
  Trash2, ChevronRight, AlertCircle, Loader2,
} from 'lucide-react'
import BoardInstallModal    from '@/components/other/BoardInstallModal'

// ─────────────────────────────────────────────────────────────────────────────

export default function PlatformsSidebar() {
  const {
    platforms, platformsLoaded, setPlatforms,
    setBoardPlatformInstalling, addInstalledPlatform, removeInstalledPlatform,
    settings,
  } = useStore()

  const [query,           setQuery]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [installTarget,   setInstallTarget]   = useState<BoardPlatform | null>(null)
  const [removingId,      setRemovingId]      = useState<string | null>(null)

  // ── Load registry once ──────────────────────────────────────────────────────

  const loadRegistry = useCallback(async (force = false) => {
    if (platformsLoaded && !force) return
    setLoading(true)
    setError(null)
    try {
      const url = settings.boardsRegistryUrl ||
        'https://raw.githubusercontent.com/tsuki-team/tsuki/refs/heads/main/boards/boards.json'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { boards: Record<string, {
        description: string; author: string; arch: string;
        category: string; latest: string; versions: Record<string, string>
      }> }

      const registryPlatforms: BoardPlatform[] = Object.entries(data.boards).map(([id, info]) => ({
        id,
        name:        idToName(id),
        version:     info.latest,
        description: info.description,
        author:      info.author,
        arch:        info.arch,
        category:    info.category,
        installed:   false,
        url:         info.versions[info.latest] ?? '',
      }))

      // Merge with already-installed status
      const installedIds = platforms.filter(p => p.installed).map(p => p.id)
      const merged = registryPlatforms.map(p => ({
        ...p,
        installed: installedIds.includes(p.id),
      }))
      setPlatforms(merged)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [platformsLoaded, settings.boardsRegistryUrl, platforms, setPlatforms])

  useEffect(() => { loadRegistry() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Remove ──────────────────────────────────────────────────────────────────

  const handleRemove = async (platform: BoardPlatform) => {
    if (removingId) return
    setRemovingId(platform.id)
    try {
      const flashBin = resolveFlashBin(settings.tsukiPath ?? '')
      await runCommand(flashBin, ['platforms', 'remove', platform.id])
      removeInstalledPlatform(platform.id)
    } catch { /* ignore */ } finally {
      setRemovingId(null)
    }
  }

  // ── Filter ──────────────────────────────────────────────────────────────────

  const filtered = platforms.filter(p =>
    !query ||
    p.id.toLowerCase().includes(query.toLowerCase()) ||
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.description.toLowerCase().includes(query.toLowerCase()) ||
    p.arch.toLowerCase().includes(query.toLowerCase())
  )

  const installedList = filtered.filter(p => p.installed)
  const availableList = filtered.filter(p => !p.installed)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
          <Cpu size={11} /> Platforms
        </span>
        <button
          onClick={() => loadRegistry(true)}
          disabled={loading}
          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          title="Refresh registry"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded px-2 py-1">
          <Search size={10} className="text-zinc-500 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search boards..."
            className="bg-transparent outline-none text-[10px] text-zinc-200 placeholder-zinc-500 w-full"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 text-red-400 bg-red-400/10 rounded px-2 py-1.5">
          <AlertCircle size={10} />
          <span className="text-[10px]">{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && !platforms.length && (
        <div className="flex justify-center items-center py-6 text-zinc-500">
          <Loader2 size={14} className="animate-spin mr-2" />
          <span>Loading registry...</span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-3">
        {installedList.length > 0 && (
          <>
            <SectionHeader label={`INSTALLED (${installedList.length})`} />
            {installedList.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                onInstall={() => setInstallTarget(p)}
                onRemove={() => handleRemove(p)}
                removing={removingId === p.id}
              />
            ))}
          </>
        )}

        {availableList.length > 0 && (
          <>
            <SectionHeader label={`AVAILABLE (${availableList.length})`} />
            {availableList.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                onInstall={() => {
                  setBoardPlatformInstalling(p.id, true)
                  setInstallTarget(p)
                }}
                onRemove={() => {}}
                removing={false}
              />
            ))}
          </>
        )}

        {!loading && !platforms.length && !error && (
          <div className="text-center text-zinc-500 py-6">No platforms found.</div>
        )}
      </div>

      {/* Install modal */}
      {installTarget && (
        <BoardInstallModal
          platform={installTarget}
          onClose={() => {
            if (installTarget) setBoardPlatformInstalling(installTarget.id, false)
            setInstallTarget(null)
          }}
          onInstalled={(p) => {
            addInstalledPlatform(p)
            setBoardPlatformInstalling(p.id, false)
            setInstallTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-1 pt-2 pb-1">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
    </div>
  )
}

function PlatformCard({
  platform, onInstall, onRemove, removing,
}: {
  platform: BoardPlatform
  onInstall: () => void
  onRemove:  () => void
  removing:  boolean
}) {
  const archColor: Record<string, string> = {
    avr:     'text-blue-400',
    esp32:   'text-orange-400',
    esp8266: 'text-green-400',
    rp2040:  'text-pink-400',
    sam:     'text-purple-400',
  }

  return (
    <div className={`
      rounded border px-2 py-2 flex flex-col gap-1
      ${platform.installed
        ? 'bg-zinc-800/80 border-zinc-600'
        : 'bg-zinc-900 border-zinc-700/50 hover:border-zinc-600'}
    `}>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {platform.installed && <CheckCircle2 size={10} className="text-green-400 shrink-0" />}
          <span className="font-medium text-zinc-200 truncate">{platform.name}</span>
        </div>
        <span className={`text-[9px] font-mono shrink-0 ${archColor[platform.arch] ?? 'text-zinc-400'}`}>
          {platform.arch}
        </span>
      </div>

      <span className="text-zinc-500 leading-tight line-clamp-2">{platform.description}</span>

      <div className="flex items-center justify-between mt-0.5">
        <span className="text-zinc-600 text-[9px]">v{platform.version} · {platform.author}</span>
        <div className="flex items-center gap-1">
          {platform.installed ? (
            <>
              <button
                onClick={onInstall}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
              >
                <ChevronRight size={8} /> Details
              </button>
              <button
                onClick={onRemove}
                disabled={removing}
                className="p-0.5 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 disabled:opacity-40"
                title="Remove platform"
              >
                {removing ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              disabled={platform.installing}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {platform.installing
                ? <><Loader2 size={9} className="animate-spin" /> Installing…</>
                : <><Download size={9} /> Install</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function idToName(id: string): string {
  const names: Record<string, string> = {
    esp32:   'ESP32 Dev Module',
    esp8266: 'ESP8266 Generic',
    uno:     'Arduino Uno',
    nano:    'Arduino Nano',
    mega:    'Arduino Mega',
    pico:    'Raspberry Pi Pico',
    due:     'Arduino Due',
  }
  return names[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function resolveFlashBin(tsukiPath: string): string {
  if (!tsukiPath) return 'tsuki-flash'
  return tsukiPath.replace(/tsuki(\.exe)?$/, 'tsuki-flash$1')
}

async function runCommand(bin: string, args: string[]): Promise<void> {
  // Dynamically import spawnProcess to avoid SSR issues
  const { spawnProcess } = await import('@/lib/tauri')
  const handle = await spawnProcess(bin, args, undefined, () => {})
  const code = await handle.done
  if (code !== 0) throw new Error(`exit ${code}`)
}
