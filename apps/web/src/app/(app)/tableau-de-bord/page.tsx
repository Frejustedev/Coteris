import type { Metadata } from 'next'
import Link from 'next/link'

import { can } from '@coteris/auth'

import { Carte, Points, StatutÉpreuve, Vide } from '~/components/ui'
import { listAssessments } from '~/lib/repositories'
import { requireUser } from '~/lib/session'

export const metadata: Metadata = { title: 'Tableau de bord' }

export default async function TableauDeBord() {
  const { principal } = await requireUser()
  const épreuves = await listAssessments(principal.organizationId)

  const peutCréer = can(principal, 'assessment', 'create')

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-titre text-2xl font-semibold text-marine-700">Épreuves</h1>
          <p className="mt-1 text-sm text-anthracite-600">
            {épreuves.length === 0
              ? 'Aucune épreuve pour le moment.'
              : `${épreuves.length} épreuve${épreuves.length > 1 ? 's' : ''} dans votre organisation.`}
          </p>
        </div>

        {/* Le bouton est masqué si le rôle ne l'autorise pas — et le serveur
            refuserait de toute façon l'action. L'interface cache, le serveur interdit. */}
        {peutCréer && (
          <Link
            href="/epreuves/nouvelle"
            className="shrink-0 rounded-md bg-marine-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-marine-600"
          >
            Nouvelle épreuve
          </Link>
        )}
      </div>

      {épreuves.length === 0 ? (
        <Vide>
          Aucune épreuve pour le moment.{' '}
          {peutCréer ? (
            <Link href="/epreuves/nouvelle" className="text-marine-700 underline underline-offset-2">
              Créez votre première épreuve
            </Link>
          ) : (
            'Votre coordonnateur doit en créer une.'
          )}
        </Vide>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {épreuves.map((é) => (
            <Link key={é.id} href={`/epreuves/${é.id}`} className="block">
              <Carte className="h-full transition hover:border-petrole-300">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-titre text-base font-semibold text-marine-700">
                      {é.title}
                    </h2>
                    {é.subject && (
                      <p className="mt-0.5 text-sm text-anthracite-600">{é.subject}</p>
                    )}
                  </div>
                  <StatutÉpreuve statut={é.status} />
                </div>

                <dl className="mt-4 flex gap-6 text-sm">
                  <div>
                    <dt className="text-xs text-anthracite-400">Barème</dt>
                    <dd className="mt-0.5">
                      <Points value={é.maxPoints} /> points
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-anthracite-400">Copies</dt>
                    <dd className="tabulaire mt-0.5">{é.submissionCount}</dd>
                  </div>
                  {é.examDate && (
                    <div>
                      <dt className="text-xs text-anthracite-400">Date</dt>
                      <dd className="tabulaire mt-0.5">
                        {new Intl.DateTimeFormat('fr-FR').format(é.examDate)}
                      </dd>
                    </div>
                  )}
                </dl>
              </Carte>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
