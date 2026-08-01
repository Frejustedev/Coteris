'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { créer } from './actions'

const champ =
  'w-full rounded-md border border-marine-100 bg-white px-3 py-2 text-sm ' +
  'placeholder:text-anthracite-400 focus:border-petrole-600 focus:outline-none'

export function FormulaireÉpreuve() {
  const router = useRouter()
  const [enCours, démarrer] = useTransition()
  const [erreurs, setErreurs] = useState<string[]>([])

  const [titre, setTitre] = useState('')
  const [matière, setMatière] = useState('')
  const [niveau, setNiveau] = useState('')
  const [promotion, setPromotion] = useState('')
  const [noteMax, setNoteMax] = useState(20)
  const [durée, setDurée] = useState<number | ''>('')
  const [anonymat, setAnonymat] = useState(true)

  function soumettre(event: React.FormEvent) {
    event.preventDefault()
    setErreurs([])

    démarrer(async () => {
      const résultat = await créer({
        title: titre,
        subject: matière.trim() || null,
        level: niveau.trim() || null,
        cohort: promotion.trim() || null,
        language: 'fr',
        maxPoints: noteMax,
        durationMinutes: durée === '' ? null : durée,
        anonymizationEnabled: anonymat,
        description: null,
      })

      if (!résultat.ok) {
        setErreurs(résultat.problèmes ? [...résultat.problèmes] : [résultat.message ?? 'Échec.'])
        return
      }

      router.push(`/epreuves/${résultat.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={soumettre} className="space-y-4">
      <div>
        <label htmlFor="titre" className="mb-1 block text-sm font-medium">
          Titre
        </label>
        <input
          id="titre"
          required
          minLength={3}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          className={champ}
          placeholder="Médecine nucléaire — session de juin"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="matiere" className="mb-1 block text-sm font-medium">
            Matière
          </label>
          <input
            id="matiere"
            value={matière}
            onChange={(e) => setMatière(e.target.value)}
            className={champ}
          />
        </div>
        <div>
          <label htmlFor="niveau" className="mb-1 block text-sm font-medium">
            Niveau
          </label>
          <input
            id="niveau"
            value={niveau}
            onChange={(e) => setNiveau(e.target.value)}
            className={champ}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="promotion" className="mb-1 block text-sm font-medium">
            Promotion
          </label>
          <input
            id="promotion"
            value={promotion}
            onChange={(e) => setPromotion(e.target.value)}
            className={champ}
          />
        </div>
        <div>
          <label htmlFor="notemax" className="mb-1 block text-sm font-medium">
            Note maximale
          </label>
          <input
            id="notemax"
            type="number"
            step="0.25"
            min={0.25}
            required
            value={noteMax}
            onChange={(e) => setNoteMax(Number(e.target.value))}
            className={`${champ} tabulaire`}
          />
          <p className="mt-1 text-xs text-anthracite-400">
            Le total des questions devra faire exactement cette valeur.
          </p>
        </div>
        <div>
          <label htmlFor="duree" className="mb-1 block text-sm font-medium">
            Durée (minutes)
          </label>
          <input
            id="duree"
            type="number"
            min={1}
            value={durée}
            onChange={(e) => setDurée(e.target.value === '' ? '' : Number(e.target.value))}
            className={`${champ} tabulaire`}
          />
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-marine-100 bg-marine-50/40 px-3 py-2.5">
        <input
          type="checkbox"
          checked={anonymat}
          onChange={(e) => setAnonymat(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm">
          Anonymiser les copies
          <span className="mt-0.5 block text-xs text-anthracite-600">
            Les correcteurs ne voient qu’un code. L’identité vit dans une table séparée, et
            toute levée d’anonymat est journalisée.
          </span>
        </span>
      </label>

      {erreurs.length > 0 && (
        <ul role="alert" className="space-y-1">
          {erreurs.map((e, i) => (
            <li
              key={i}
              className="rounded-md border border-rouge-bd bg-rouge-bg px-3 py-2 text-sm text-rouge-fg"
            >
              {e}
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={enCours}
        className="w-full rounded-md bg-marine-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-marine-600 disabled:opacity-40"
      >
        {enCours ? 'Création…' : 'Créer l’épreuve'}
      </button>
    </form>
  )
}
