'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { importer } from './actions'

interface Journal {
  fichier: string
  ok: boolean
  texte: string
}

export function PanneauImport({
  assessmentId,
  peutImporter,
}: {
  assessmentId: string
  peutImporter: boolean
}) {
  const router = useRouter()
  const champ = useRef<HTMLInputElement>(null)
  const [enCours, démarrer] = useTransition()
  const [journal, setJournal] = useState<Journal[]>([])
  const [survol, setSurvol] = useState(false)

  if (!peutImporter) {
    return (
      <p className="text-sm text-anthracite-600">
        Votre rôle ne permet pas d’importer des copies.
      </p>
    )
  }

  function envoyer(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return
    const liste = Array.from(fichiers)
    setJournal([])

    démarrer(async () => {
      const résultats: Journal[] = []
      // Séquentiel : chaque copie prend un code anonyme incrémental, et deux
      // imports simultanés se disputeraient le même numéro.
      for (const fichier of liste) {
        const formulaire = new FormData()
        formulaire.set('assessmentId', assessmentId)
        formulaire.set('fichier', fichier)

        const résultat = await importer(formulaire)
        résultats.push({
          fichier: fichier.name,
          ok: résultat.ok,
          texte: résultat.message ?? (résultat.ok ? 'Importée.' : 'Échec.'),
        })
        setJournal([...résultats])
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setSurvol(true)
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          e.preventDefault()
          setSurvol(false)
          envoyer(e.dataTransfer.files)
        }}
        className={`rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${
          survol ? 'border-petrole-600 bg-petrole-50' : 'border-marine-100 bg-marine-50/40'
        }`}
      >
        <p className="text-sm text-anthracite-600">
          Glissez des copies ici, ou
          <button
            type="button"
            disabled={enCours}
            onClick={() => champ.current?.click()}
            className="ml-1 font-medium text-marine-700 underline underline-offset-2 disabled:opacity-40"
          >
            choisissez des fichiers
          </button>
        </p>
        <p className="mt-2 text-xs text-anthracite-400">
          JPEG, PNG ou WEBP. Le format est vérifié sur le contenu du fichier, pas sur son
          extension. Les PDF ne sont pas encore pris en charge.
        </p>

        <input
          ref={champ}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => envoyer(e.target.files)}
        />
      </div>

      {enCours && (
        <p className="text-sm text-anthracite-600">Import en cours…</p>
      )}

      {journal.length > 0 && (
        <ul className="space-y-1.5">
          {journal.map((j, i) => (
            <li
              key={i}
              className={`rounded-md border px-3 py-2 text-xs ${
                j.ok
                  ? 'border-vert-bd bg-vert-bg text-vert-fg'
                  : 'border-rouge-bd bg-rouge-bg text-rouge-fg'
              }`}
            >
              <span className="tabulaire font-medium">{j.fichier}</span> — {j.texte}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-anthracite-400">
        La segmentation est déduite d’une hypothèse de mise en page — une zone de réponse
        par question, dans l’ordre — et non détectée. Elle doit être vérifiée. Les analyses
        sont mises en file et traitées par le worker.
      </p>
    </div>
  )
}
