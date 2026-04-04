'use client'
/**
 * MigrationModal — detecta features eliminadas en un proyecto abierto y guía
 * al usuario para actualizarlo a la versión compatible más cercana.
 *
 * Sistema de migraciones:
 *  · Cada migración tiene un id único, una descripción del problema y una
 *    función `apply` que transforma el manifest (tsuki_package.json).
 *  · `detectMigrations(manifest)` evalúa qué migraciones aplican.
 *  · El modal muestra un resumen y aplica los cambios al guardar.
 *
 * Para añadir una nueva migración en el futuro, basta con añadir una entrada
 * al array MIGRATIONS sin tocar el resto del sistema.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, X, Wrench, FileJson } from 'lucide-react'
import { clsx } from 'clsx'

// ─────────────────────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectManifest = Record<string, unknown>

export interface Migration {
  /** Identificador único y estable de esta migración. */
  id: string
  /** Título corto mostrado en el modal. */
  title: string
  /** Descripción del problema para el usuario. */
  problem: string
  /** Descripción del cambio que se va a aplicar. */
  fix: string
  /** Severidad visual: error bloquea el build, warning es cosmético. */
  severity: 'error' | 'warning'
  /** Devuelve true si esta migración aplica al manifest dado. */
  detect: (manifest: ProjectManifest) => boolean
  /** Transforma el manifest en-place y devuelve el manifest modificado. */
  apply: (manifest: ProjectManifest) => ProjectManifest
}

// ─────────────────────────────────────────────────────────────────────────────
//  Catálogo de migraciones
//  ↓ Añade nuevas entradas aquí cuando elimines una feature. ↓
// ─────────────────────────────────────────────────────────────────────────────

export const MIGRATIONS: Migration[] = [
  {
    id:       'remove-tsuki-flash-cores',
    title:    'Backend "tsuki-flash+cores" eliminado',
    problem:
      'Este proyecto usa el backend "tsuki-flash+cores", que descargaba y gestionaba ' +
      'los cores de Arduino automáticamente desde ~/.tsuki/modules/. ' +
      'Esta funcionalidad ha sido eliminada.',
    fix:
      'El backend se cambiará a "tsuki-flash", que usa directamente los cores instalados ' +
      'en ~/.arduino15 (por el Arduino IDE o arduino-cli). El comportamiento de compilación ' +
      'y flash es idéntico.',
    severity: 'error',
    detect:   (m) => m.backend === 'tsuki-flash+cores',
    apply:    (m) => ({ ...m, backend: 'tsuki-flash' }),
  },
  {
    id:       'remove-rp2040-boards',
    title:    'Placa RP2040 no soportada',
    problem:
      'Este proyecto usa una placa RP2040 ("pico" o "xiao_rp2040") que ha sido ' +
      'eliminada del soporte oficial de tsuki. El soporte para RP2040 estaba ' +
      'incompleto y ha sido retirado temporalmente.',
    fix:
      'La placa se cambiará a "uno" (Arduino Uno). Puedes seleccionar otra placa ' +
      'compatible desde el selector de placa en la barra superior del IDE.',
    severity: 'error',
    detect:   (m) => m.board === 'pico' || m.board === 'xiao_rp2040',
    apply:    (m) => ({ ...m, board: 'uno' }),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Lógica pública: detectar migraciones pendientes
// ─────────────────────────────────────────────────────────────────────────────

export function detectMigrations(manifest: ProjectManifest): Migration[] {
  return MIGRATIONS.filter(mg => mg.detect(manifest))
}

/** Aplica todas las migraciones indicadas al manifest y devuelve el resultado. */
export function applyMigrations(
  manifest: ProjectManifest,
  migrations: Migration[],
): ProjectManifest {
  return migrations.reduce((acc, mg) => mg.apply(acc), { ...manifest })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Componente modal
// ─────────────────────────────────────────────────────────────────────────────

interface MigrationModalProps {
  /** Migraciones detectadas para este proyecto. */
  migrations: Migration[]
  /** Nombre del proyecto, para el título del modal. */
  projectName: string
  /** Callback cuando el usuario acepta y aplica las migraciones. */
  onApply: () => void
  /** Callback cuando el usuario cierra sin aplicar (solo posible si no hay errores). */
  onDismiss: () => void
}

export default function MigrationModal({
  migrations,
  projectName,
  onApply,
  onDismiss,
}: MigrationModalProps) {
  const [applied, setApplied] = useState(false)
  const hasErrors = migrations.some(m => m.severity === 'error')

  // Animación de entrada
  const [visible, setVisible] = useState(false)
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  function handleApply() {
    setApplied(true)
    setTimeout(onApply, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={clsx(
          'relative w-full max-w-lg mx-4 rounded-xl border shadow-2xl transition-all duration-300',
          'bg-[var(--bg-panel)] border-[var(--border)]',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-[var(--border)]">
          <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <AlertTriangle size={16} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--fg)]">
              Proyecto incompatible — migración necesaria
            </h2>
            <p className="text-xs text-[var(--fg-muted)] mt-0.5 truncate">
              {projectName}
            </p>
          </div>
          {/* Solo mostrar X si no hay errores (warning-only) */}
          {!hasErrors && !applied && (
            <button
              onClick={onDismiss}
              className="flex-shrink-0 text-[var(--fg-faint)] hover:text-[var(--fg)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 max-h-72 overflow-y-auto">
          {applied ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={32} className="text-green-400 animate-pulse" />
              <p className="text-sm text-[var(--fg-muted)] text-center">
                Migraciones aplicadas correctamente.
              </p>
            </div>
          ) : (
            migrations.map(mg => (
              <MigrationCard key={mg.id} migration={mg} />
            ))
          )}
        </div>

        {/* Footer */}
        {!applied && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border)]">
            <div className="flex items-center gap-1.5 text-xs text-[var(--fg-faint)]">
              <FileJson size={12} />
              <span>Se actualizará <code className="font-mono">tsuki_package.json</code></span>
            </div>
            <div className="flex gap-2">
              {!hasErrors && (
                <button
                  onClick={onDismiss}
                  className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)] transition-colors"
                >
                  Ignorar
                </button>
              )}
              <button
                onClick={handleApply}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
              >
                <Wrench size={12} />
                Aplicar migración{migrations.length > 1 ? 'es' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-componente: tarjeta de una migración individual
// ─────────────────────────────────────────────────────────────────────────────

function MigrationCard({ migration: mg }: { migration: Migration }) {
  const isError = mg.severity === 'error'
  return (
    <div className={clsx(
      'rounded-lg border p-3.5 space-y-2.5',
      isError
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-amber-500/30 bg-amber-500/5',
    )}>
      {/* Título + badge */}
      <div className="flex items-center gap-2">
        <span className={clsx(
          'text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide',
          isError
            ? 'bg-red-500/20 text-red-400'
            : 'bg-amber-500/20 text-amber-400',
        )}>
          {isError ? 'error' : 'aviso'}
        </span>
        <span className="text-xs font-medium text-[var(--fg)]">{mg.title}</span>
      </div>

      {/* Problema → Fix */}
      <div className="grid grid-cols-[1fr_16px_1fr] gap-2 items-start">
        <div>
          <p className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wide mb-1">
            Problema
          </p>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{mg.problem}</p>
        </div>
        <ArrowRight size={12} className="text-[var(--fg-faint)] mt-4" />
        <div>
          <p className="text-[10px] font-semibold text-[var(--fg-faint)] uppercase tracking-wide mb-1">
            Corrección
          </p>
          <p className="text-xs text-[var(--fg-muted)] leading-relaxed">{mg.fix}</p>
        </div>
      </div>
    </div>
  )
}