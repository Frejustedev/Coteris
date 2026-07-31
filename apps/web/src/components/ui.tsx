/**
 * Composants d'interface partagés.
 *
 * Tailwind et composants maison, pas de bibliothèque lourde. L'interface doit
 * rester sobre : elle accompagne une décision qui engage un enseignant devant un
 * jury.
 */

import type { ReactNode } from 'react'

// --- Points ------------------------------------------------------------------

/**
 * Affiche des points stockés en millièmes.
 *
 * La conversion en décimal n'a lieu qu'ici, à l'affichage — jamais dans les
 * calculs (voir docs/adr/0006-arithmetique-des-points.md).
 */
export function formatPoints(millipoints: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(millipoints / 1000)
}

export function Points({ value, max }: { value: number; max?: number | undefined }) {
  return (
    <span className="tabulaire">
      {formatPoints(value)}
      {max !== undefined && <span className="text-anthracite-400"> / {formatPoints(max)}</span>}
    </span>
  )
}

// --- Niveaux de confiance -----------------------------------------------------

export type Niveau = 'green' | 'orange' | 'red'

const NIVEAUX: Record<Niveau, { label: string; classes: string }> = {
  green: {
    label: 'Confiance élevée',
    classes: 'bg-vert-bg text-vert-fg border-vert-bd',
  },
  orange: {
    label: 'À vérifier',
    classes: 'bg-orange-bg text-orange-fg border-orange-bd',
  },
  red: {
    label: 'Validation humaine requise',
    classes: 'bg-rouge-bg text-rouge-fg border-rouge-bd',
  },
}

export function BadgeConfiance({
  niveau,
  score,
  compact = false,
}: {
  niveau: Niveau | null
  score?: number | null
  compact?: boolean
}) {
  if (!niveau) {
    return (
      <span className="inline-flex items-center rounded-md border border-anthracite-400/40 bg-white px-2 py-0.5 text-xs text-anthracite-600">
        Non analysé
      </span>
    )
  }

  const { label, classes } = NIVEAUX[niveau]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {compact ? '' : label}
      {score !== null && score !== undefined && (
        <span className="tabulaire opacity-70">{Math.round(score * 100)} %</span>
      )}
    </span>
  )
}

// --- Conteneurs ----------------------------------------------------------------

export function Carte({
  titre,
  action,
  children,
  className = '',
}: {
  titre?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-marine-100 bg-white shadow-[0_1px_2px_rgba(13,46,103,0.04)] ${className}`}
    >
      {titre && (
        <header className="flex items-center justify-between gap-4 border-b border-marine-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-marine-700">{titre}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Étiquette({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-anthracite-400">
      {children}
    </span>
  )
}

export function Vide({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-marine-100 bg-marine-50/40 px-4 py-6 text-center text-sm text-anthracite-600">
      {children}
    </p>
  )
}

// --- Statuts d'épreuve ----------------------------------------------------------

const STATUTS: Record<string, string> = {
  DRAFT: 'Brouillon',
  SUBJECT_REVIEW: 'Vérification du sujet',
  ANSWER_KEY_REVIEW: 'Vérification du corrigé',
  RUBRIC_REVIEW: 'Vérification du barème',
  READY_FOR_SUBMISSIONS: 'Prête pour les copies',
  SUBMISSIONS_PROCESSING: 'Traitement des copies',
  GRADING: 'Correction en cours',
  HUMAN_REVIEW: 'Validation humaine',
  FINALIZED: 'Finalisée',
  PUBLISHED: 'Publiée',
  ARCHIVED: 'Archivée',
}

export function StatutÉpreuve({ statut }: { statut: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-marine-50 px-2 py-0.5 text-xs font-medium text-marine-600">
      {STATUTS[statut] ?? statut}
    </span>
  )
}

const QUALITÉS: Record<string, { label: string; classes: string }> = {
  acceptable: { label: 'Scan acceptable', classes: 'text-vert-fg' },
  auto_improvable: { label: 'Améliorable', classes: 'text-anthracite-600' },
  check_recommended: { label: 'Vérification recommandée', classes: 'text-orange-fg' },
  reimport_required: { label: 'Nouvel import nécessaire', classes: 'text-rouge-fg' },
}

export function QualitéScan({ qualité }: { qualité: string | null }) {
  if (!qualité) return null
  const q = QUALITÉS[qualité]
  if (!q) return null
  return <span className={`text-xs ${q.classes}`}>{q.label}</span>
}
