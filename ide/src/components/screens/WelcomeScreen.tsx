'use client'
import { useState, useEffect, useRef } from 'react'
import NewProjectModal from '@/components/other/NewProjectModal'
import { useStore } from '@/lib/store'
import { Btn } from '@/components/shared/primitives'
import { Plus, FolderOpen, Settings, Clock, ChevronRight, BookOpen, MoreHorizontal, FolderSearch, Trash2, X } from 'lucide-react'
import { useT } from '@/lib/i18n'
import TsukiLogo from '@/components/shared/TsukiLogo'
import { MinimalChrome } from '@/components/shared/AppChrome'
import { pathExists, revealInFileManager, removeDirectory } from '@/lib/tauri'

// ── Per-recent-item action menu ───────────────────────────────────────────────

function RecentItemMenu({
  project,
  onClose,
  onRemove,
  onDelete,
  onLocate,
}: {
  project: { name: string; path: string }
  onClose: () => void
  onRemove: () => void
  onDelete: () => void
  onLocate: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-xl py-1 animate-fade-in"
    >
      <button
        onClick={() => { onLocate(); onClose() }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent border-0 text-left"
      >
        <FolderSearch size={12} className="flex-shrink-0" />
        Reveal in Explorer
      </button>
      <div className="h-px bg-[var(--border)] mx-2 my-1" />
      <button
        onClick={() => { onRemove(); onClose() }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent border-0 text-left"
      >
        <X size={12} className="flex-shrink-0" />
        Remove from recents
      </button>
      <button
        onClick={() => { onDelete(); onClose() }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_8%,transparent)] transition-colors cursor-pointer bg-transparent border-0 text-left"
      >
        <Trash2 size={12} className="flex-shrink-0" />
        Delete project
      </button>
    </div>
  )
}

// ── Delete confirmation ────────────────────────────────────────────────────────

function DeleteConfirmModal({
  projectName,
  onConfirm,
  onCancel,
}: {
  projectName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div className="w-80 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl p-5 animate-fade-up">
        <div className="flex items-center gap-2.5 mb-3">
          <Trash2 size={14} className="text-[var(--err)] flex-shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--fg)]">Delete project?</h3>
        </div>
        <p className="text-xs text-[var(--fg-muted)] mb-1">
          This will permanently delete <span className="font-semibold text-[var(--fg)]">{projectName}</span> and all its files from disk.
        </p>
        <p className="text-xs text-[var(--err)] mb-5">This action cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded border border-[var(--border)] text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded text-xs font-semibold bg-[var(--err)] text-white hover:opacity-85 transition-opacity cursor-pointer border-0"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function WelcomeScreen() {
  const { setScreen, loadFromDisk, recentProjects, removeRecentProject } = useStore()
  const [opening, setOpening] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ name: string; path: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const t = useT()

  // ── Filter out recents whose folder no longer exists ──────────────────────
  useEffect(() => {
    async function pruneStale() {
      for (const r of recentProjects) {
        const exists = await pathExists(r.path)
        if (!exists) removeRecentProject(r.path)
      }
    }
    pruneStale()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function openFolder() {
    setOpening(true)
    try {
      const { pickFolder, isTauri } = await import('@/lib/tauri')
      if (!isTauri()) { setOpening(false); return }
      const folder = await pickFolder()
      if (!folder) { setOpening(false); return }
      await loadFromDisk(folder)
    } catch (e) {
      console.error('[tsuki-ide] openFolder error:', e)
    }
    setOpening(false)
  }

  async function handleDelete(name: string, path: string) {
    setDeleting(path)
    try {
      await removeDirectory(path)
    } catch (e) {
      console.error('[tsuki-ide] handleDelete error:', e)
    }
    removeRecentProject(path)
    setDeleting(null)
    setConfirmDelete(null)
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)] rounded-[10px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--chrome-border,#1e2022)]">
      <MinimalChrome title="Welcome" />

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-8 overflow-auto">
        <div className="w-full max-w-[520px] flex flex-col gap-8 items-start py-10">

          <div className="flex-1 min-w-0 animate-fade-up">
            <div className="flex items-center gap-3 mb-1.5">
              <TsukiLogo size="lg" />
              <h1 className="text-2xl font-semibold tracking-tight">tsuki</h1>
            </div>
            <p className="text-sm text-[var(--fg-muted)] mb-8">
              {t('welcome.tagline')}
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-1.5 mb-8">
              <button
                onClick={() => setShowNewModal(true)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md bg-[var(--fg)] text-[var(--accent-inv)] text-sm font-semibold hover:opacity-85 transition-opacity cursor-pointer border-0"
              >
                <Plus size={14} />
                {t('welcome.newProject')}
              </button>
              <button
                onClick={openFolder}
                disabled={opening}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-50"
              >
                <FolderOpen size={14} />
                {opening ? t('welcome.openFolder_busy') : t('welcome.openFolder')}
              </button>
              <button
                onClick={() => setScreen('settings')}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
              >
                <Settings size={14} />
                {t('welcome.settingsCli')}
              </button>
              <button
                onClick={() => setScreen('docs')}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
              >
                <BookOpen size={14} />
                {t('common.documentation')}
              </button>
            </div>

            {/* Recent */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock size={11} className="text-[var(--fg-faint)]" />
                <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">{t('welcome.recent')}</span>
              </div>
              <div className="flex flex-col">
                {recentProjects.length === 0 && (
                  <p className="text-xs text-[var(--fg-faint)] px-2">{t('welcome.noRecent')}</p>
                )}
                {recentProjects.map(r => (
                  <div key={r.path} className="relative group flex items-center">
                    <button
                      onClick={() => loadFromDisk(r.path)}
                      disabled={deleting === r.path}
                      className="flex-1 flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent text-left disabled:opacity-40"
                    >
                      <div className="w-7 h-7 rounded border border-[var(--border)] flex items-center justify-center text-[var(--fg-faint)] flex-shrink-0">
                        <span className="font-mono text-[10px] font-bold">{r.board?.startsWith('esp') ? 'esp' : 'go'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--fg)] truncate">{r.name}</div>
                        <div className="text-xs text-[var(--fg-faint)] truncate font-mono">{r.path}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 mr-1">
                        <span className="text-xs font-mono text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                          {r.board}
                        </span>
                      </div>
                    </button>

                    {/* ··· menu button */}
                    <div className="relative flex-shrink-0 pr-1">
                      <button
                        onClick={e => { e.stopPropagation(); setOpenMenuPath(openMenuPath === r.path ? null : r.path) }}
                        className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--active)] transition-colors cursor-pointer border-0 bg-transparent opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Project options"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                      {openMenuPath === r.path && (
                        <RecentItemMenu
                          project={r}
                          onClose={() => setOpenMenuPath(null)}
                          onLocate={() => revealInFileManager(r.path)}
                          onRemove={() => removeRecentProject(r.path)}
                          onDelete={() => setConfirmDelete({ name: r.name, path: r.path })}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center px-5 border-t border-[var(--border)] flex-shrink-0">
        <span className="text-xs text-[var(--fg-faint)] font-mono">v1.0.0</span>
        <span className="ml-auto text-xs text-[var(--fg-faint)]">{t('welcome.footer_stack')}</span>
      </div>

      {/* New project modal */}
      {showNewModal && (
        <NewProjectModal onClose={() => setShowNewModal(false)} />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <DeleteConfirmModal
          projectName={confirmDelete.name}
          onConfirm={() => handleDelete(confirmDelete.name, confirmDelete.path)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}