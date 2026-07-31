import type { Metadata } from 'next'

import { can } from '@coteris/auth'

import { Carte, Vide } from '~/components/ui'
import { listAuditEvents } from '~/lib/repositories'
import { requireUser } from '~/lib/session'

export const metadata: Metadata = { title: 'Historique' }

const LIBELLÉS: Record<string, string> = {
  'auth.login': 'Connexion',
  'assessment.create': 'Création d’épreuve',
  'assessment.status_change': 'Changement d’état',
  'subject.import': 'Import du sujet',
  'question.update': 'Modification de question',
  'answer_key.create': 'Création du corrigé',
  'answer_key.validate': 'Validation du corrigé',
  'rubric.create': 'Création du barème',
  'rubric.validate': 'Validation du barème',
  'rubric.lock': 'Verrouillage du barème',
  'submission.import': 'Import d’une copie',
  'ocr.run': 'Lecture de la copie',
  'transcription.edit': 'Correction de transcription',
  'grade.propose': 'Proposition de note',
  'grade.review': 'Validation d’une décision',
  'grade.modify': 'Modification d’une note',
  'grade.finalize': 'Finalisation de la note',
  'grade.publish': 'Publication',
  'export.create': 'Export',
  'identity.reveal': 'Levée d’anonymat',
  'permission.change': 'Changement de permission',
  'assignment.change': 'Attribution de copie',
}

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
                  <p className="text-sm font-medium">{LIBELLÉS[e.action] ?? e.action}</p>
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
