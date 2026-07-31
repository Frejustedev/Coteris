import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BadgeConfiance, Carte, Points, QualitéScan, StatutÉpreuve, Vide } from '~/components/ui'
import { can } from '@coteris/auth'

import {
  getAssessment,
  getAssessmentStats,
  listExports,
  listQuestions,
  listSubmissions,
} from '~/lib/repositories'
import { requireUser } from '~/lib/session'
import { PanneauExports } from './exports'
import { PanneauImport } from './import'

export const metadata: Metadata = { title: 'Épreuve' }

export default async function ÉpreuvePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { principal } = await requireUser()

  // L'organisation vient de la session. Une épreuve d'un autre établissement
  // n'est pas « refusée » : elle est introuvable.
  const épreuve = await getAssessment(principal.organizationId, id)
  if (!épreuve) notFound()

  const [questions, copies, stats, exports] = await Promise.all([
    listQuestions(principal.organizationId, id),
    listSubmissions(principal.organizationId, id),
    getAssessmentStats(principal.organizationId, id),
    listExports(principal.organizationId, id),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tableau-de-bord" className="text-sm text-anthracite-400 hover:text-marine-600">
          ← Toutes les épreuves
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-titre text-2xl font-semibold text-marine-700">{épreuve.title}</h1>
            <p className="mt-1 text-sm text-anthracite-600">
              {épreuve.subject} · {épreuve.cohort} · <Points value={épreuve.maxPoints} /> points
            </p>
          </div>
          <StatutÉpreuve statut={épreuve.status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Statistique libellé="Copies" valeur={String(stats.submissions)} />
        <Statistique
          libellé="Moyenne"
          valeur={
            stats.averageExact === null
              ? '—'
              : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(
                  stats.averageExact / 1000,
                )} / ${stats.maxPoints / 1000}`
          }
        />
        <Statistique
          libellé="Analyses par niveau"
          valeur={`${stats.green} · ${stats.orange} · ${stats.red}`}
          détail="vertes · orange · rouges"
        />
        <Statistique
          libellé="Copies finalisées"
          valeur={`${stats.graded} / ${stats.submissions}`}
        />
      </div>

      <Carte titre={`Copies (${copies.length})`}>
        {copies.length === 0 ? (
          <Vide>Aucune copie importée.</Vide>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-marine-50 text-left text-xs uppercase tracking-wide text-anthracite-400">
                  <th className="pb-2 font-medium">Copie</th>
                  <th className="pb-2 font-medium">Qualité du scan</th>
                  <th className="pb-2 font-medium">Analyses</th>
                  <th className="pb-2 text-right font-medium">Note proposée</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-marine-50">
                {copies.map((c) => (
                  <tr key={c.id} className="group">
                    <td className="py-3">
                      <span className="tabulaire font-medium text-marine-700">
                        {c.anonymousCode}
                      </span>
                    </td>
                    <td className="py-3">
                      <QualitéScan qualité={c.quality} />
                    </td>
                    <td className="py-3">
                      <div className="flex gap-1.5">
                        {c.greenCount > 0 && (
                          <Compteur niveau="green" nombre={c.greenCount} />
                        )}
                        {c.orangeCount > 0 && (
                          <Compteur niveau="orange" nombre={c.orangeCount} />
                        )}
                        {c.redCount > 0 && <Compteur niveau="red" nombre={c.redCount} />}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      {c.pointsExact === null ? (
                        <span className="text-anthracite-400">—</span>
                      ) : (
                        <Points value={c.pointsExact} max={c.pointsMax ?? undefined} />
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/copies/${c.id}`}
                        className="rounded-md bg-marine-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-marine-600"
                      >
                        Corriger
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Carte>

      <Carte titre="Importer des copies">
        <PanneauImport
          assessmentId={id}
          peutImporter={can(principal, 'submission', 'create')}
        />
      </Carte>

      <Carte titre="Exports">
        <PanneauExports
          assessmentId={id}
          existants={exports}
          peutExporter={can(principal, 'export', 'create')}
          peutLireAudit={can(principal, 'audit', 'read')}
        />
      </Carte>

      <Carte titre={`Questions (${questions.length})`}>
        <ol className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="flex gap-4 border-b border-marine-50 pb-3 last:border-0">
              <span className="tabulaire w-8 shrink-0 font-semibold text-marine-600">
                {q.number}
              </span>
              <p className="flex-1 text-sm">{q.prompt}</p>
              <span className="shrink-0 text-sm text-anthracite-600">
                <Points value={q.maxPoints} /> pt
              </span>
            </li>
          ))}
        </ol>
      </Carte>
    </div>
  )
}

function Statistique({
  libellé,
  valeur,
  détail,
}: {
  libellé: string
  valeur: string
  détail?: string
}) {
  return (
    <div className="rounded-lg border border-marine-100 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-anthracite-400">{libellé}</p>
      <p className="tabulaire mt-1 text-xl font-semibold text-marine-700">{valeur}</p>
      {détail && <p className="mt-0.5 text-xs text-anthracite-400">{détail}</p>}
    </div>
  )
}

function Compteur({ niveau, nombre }: { niveau: 'green' | 'orange' | 'red'; nombre: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <BadgeConfiance niveau={niveau} compact />
      <span className="tabulaire text-xs text-anthracite-600">{nombre}</span>
    </span>
  )
}
