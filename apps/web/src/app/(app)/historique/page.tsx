import type { Metadata } from 'next'

import { can } from '@coteris/auth'

import { Carte, Vide } from '~/components/ui'
import { listAuditEvents } from '~/lib/repositories'
import { requireUser } from '~/lib/session'

export const metadata: Metadata = { title: 'Historique' }

// Table unique, tenue à côté du catalogue d'actions. Elle était recopiée ici et
// dans l'export CSV, et les deux copies avaient commencé à diverger.
import { libelléAction } from '@coteris/database'

export default async function Historique() {
  const { principal } = await requireUser()

  if (!can(principal, 'audit', 'read')) {
    return (
      <Vide>Votre rôle ne permet pas de consulter le journal d’audit.</Vide>
    )
  }

  const événements = await listAuditEvents(principal.organizationId, 100)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-titre text-2xl font-semibold text-marine-700">Historique</h1>
        <p className="mt-1 max-w-2xl text-sm text-anthracite-600">
          Journal en ajout seul. Chaque événement contient le hash du précédent : toute
          modification ou suppression rompt la chaîne et devient détectable. Vérifiez son
          intégrité avec <code className="tabulaire">pnpm audit:verify</code>.
        </p>
      </div>

      <Carte titre={`${événements.length} derniers événements`}>
        {événements.length === 0 ? (
          <Vide>Aucun événement enregistré.</Vide>
        ) : (
          <ol className="divide-y divide-marine-50">
            {événements.map((e) => (
              <li key={e.id} className="flex items-baseline gap-4 py-2.5">
                <span className="tabulaire w-12 shrink-0 text-xs text-anthracite-400">
                  #{e.sequence}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{libelléAction(e.action)}</p>
                  {e.reason && (
                    <p className="mt-0.5 text-xs text-anthracite-600">{e.reason}</p>
                  )}
                </div>
                <span className="tabulaire shrink-0 text-xs text-anthracite-400">
                  {e.objectType}
                </span>
                <time className="tabulaire shrink-0 text-xs text-anthracite-400">
                  {new Intl.DateTimeFormat('fr-FR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(e.occurredAt)}
                </time>
                <span
                  className="tabulaire shrink-0 text-xs text-anthracite-400"
                  title={e.hash}
                >
                  {e.hash.slice(0, 8)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Carte>
    </div>
  )
}
