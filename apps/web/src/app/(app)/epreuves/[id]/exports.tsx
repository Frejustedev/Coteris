'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { lancerExport } from './actions'

interface ExportExistant {
  id: string
  fileName: string | null
  kind: string
  createdAt: Date
}

const GENRES = [
  { clé: 'resultats' as const, libellé: 'Résultats (CSV)' },
  { clé: 'audit' as const, libellé: 'Rapport d’audit (CSV)' },
]

export function PanneauExports({
  assessmentId,
  existants,
  peutExporter,
  peutLireAudit,
}: {
  assessmentId: string
  existants: ExportExistant[]
  peutExporter: boolean
  peutLireAudit: boolean
}) {
  const router = useRouter()
  const [enCours, démarrer] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)

  if (!peutExporter) {
    return (
      <p className="text-sm text-anthracite-600">
        Votre rôle ne permet pas de créer un export.
      </p>
    )
  }

  function générer(genre: 'resultats' | 'audit') {
    setMessage(null)
    démarrer(async () => {
      const résultat = await lancerExport({ assessmentId, genre })
      setMessage({
        ok: résultat.ok,
        texte: résultat.ok
          ? `Export « ${résultat.fileName} » prêt.`
          : (résultat.message ?? 'L’export a échoué.'),
      })
      if (résultat.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {GENRES.filter((g) => g.clé !== 'audit' || peutLireAudit).map((g) => (
          <button
            key={g.clé}
            type="button"
            disabled={enCours}
            onClick={() => générer(g.clé)}
            className="rounded-md bg-marine-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-marine-600 disabled:opacity-40"
          >
            {enCours ? 'Génération…' : g.libellé}
          </button>
        ))}
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            message.ok
              ? 'border-vert-bd bg-vert-bg text-vert-fg'
              : 'border-rouge-bd bg-rouge-bg text-rouge-fg'
          }`}
        >
          {message.texte}
        </p>
      )}

      {existants.length > 0 && (
        <ul className="divide-y divide-marine-50 border-t border-marine-50 pt-2">
          {existants.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="tabulaire truncate text-sm">{e.fileName}</p>
                <p className="text-xs text-anthracite-400">
                  {new Intl.DateTimeFormat('fr-FR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(e.createdAt)}
                </p>
              </div>
              <a
                href={`/api/exports/${e.id}`}
                className="shrink-0 rounded-md border border-marine-100 px-3 py-1.5 text-xs transition hover:bg-marine-50"
              >
                Télécharger
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-anthracite-400">
        Un export fige un état des notes à un instant précis : il est conservé tel quel, non
        régénéré au téléchargement. Deux membres d’un jury travaillent ainsi sur le même
        document. Les exports expirent après trente jours.
      </p>
    </div>
  )
}
