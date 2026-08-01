'use client'

/**
 * Préparation d'une épreuve : ajout des questions puis verrouillage.
 *
 * Le panneau disparaît une fois le barème verrouillé : après ce moment, plus
 * rien ne se modifie, et laisser les champs visibles laisserait croire le
 * contraire.
 */

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { ajouter, verrouiller } from './actions'

const champ =
  'w-full rounded-md border border-marine-100 bg-white px-3 py-2 text-sm ' +
  'placeholder:text-anthracite-400 focus:border-petrole-600 focus:outline-none'

interface Critère {
  label: string
  maxPoints: number
  formulations: string
}

const TYPES = [
  { valeur: 'short_answer', libellé: 'Réponse courte' },
  { valeur: 'short_essay', libellé: 'Rédactionnelle courte' },
  { valeur: 'clinical_case', libellé: 'Cas clinique' },
  { valeur: 'mcq', libellé: 'QCM' },
  { valeur: 'true_false', libellé: 'Vrai ou faux' },
] as const

export function PanneauPréparation({
  assessmentId,
  peutModifier,
  peutVerrouiller,
  nombreQuestions,
  totalQuestions,
  noteMax,
}: {
  assessmentId: string
  peutModifier: boolean
  peutVerrouiller: boolean
  nombreQuestions: number
  /** Somme des barèmes de questions, en millièmes. */
  totalQuestions: number
  /** Note maximale de l'épreuve, en millièmes. */
  noteMax: number
}) {
  const router = useRouter()
  const [enCours, démarrer] = useTransition()
  const [erreurs, setErreurs] = useState<string[]>([])
  const [ouvert, setOuvert] = useState(nombreQuestions === 0)

  const [numéro, setNuméro] = useState(String(nombreQuestions + 1))
  const [énoncé, setÉnoncé] = useState('')
  const [type, setType] = useState<(typeof TYPES)[number]['valeur']>('short_answer')
  const [points, setPoints] = useState(1)
  const [corrigé, setCorrigé] = useState('')
  const [critères, setCritères] = useState<Critère[]>([
    { label: '', maxPoints: 1, formulations: '' },
  ])

  const sommeCritères = critères.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0)
  const cohérent = Math.abs(sommeCritères - points) < 0.0005
  const restant = (noteMax - totalQuestions) / 1000

  function ajouterQuestion() {
    setErreurs([])
    démarrer(async () => {
      const résultat = await ajouter({
        assessmentId,
        number: numéro,
        prompt: énoncé,
        type,
        maxPoints: points,
        answerKey: corrigé,
        critères: critères.map((c) => ({
          label: c.label,
          maxPoints: c.maxPoints,
          acceptableAnswers: c.formulations
            .split(/[;\n]/)
            .map((f) => f.trim())
            .filter((f) => f.length > 0),
        })),
      })

      if (!résultat.ok) {
        setErreurs(résultat.problèmes ? [...résultat.problèmes] : [résultat.message ?? 'Échec.'])
        return
      }

      setNuméro(String(nombreQuestions + 2))
      setÉnoncé('')
      setCorrigé('')
      setCritères([{ label: '', maxPoints: 1, formulations: '' }])
      router.refresh()
    })
  }

  function verrouillerBarème() {
    setErreurs([])
    démarrer(async () => {
      const résultat = await verrouiller({ assessmentId })
      if (!résultat.ok) {
        setErreurs(résultat.problèmes ? [...résultat.problèmes] : [résultat.message ?? 'Échec.'])
        return
      }
      router.refresh()
    })
  }

  if (!peutModifier) {
    return (
      <p className="text-sm text-anthracite-600">
        Votre rôle ne permet pas de préparer cette épreuve.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-marine-100 bg-marine-50/40 px-3 py-2.5">
        <p className="text-sm">
          <span className="tabulaire font-medium">{totalQuestions / 1000}</span> point(s)
          répartis sur {nombreQuestions} question(s), pour une note maximale de{' '}
          <span className="tabulaire font-medium">{noteMax / 1000}</span>.
          {restant !== 0 && (
            <span className={restant > 0 ? ' text-orange-fg' : ' text-rouge-fg'}>
              {' '}
              {restant > 0
                ? `Il reste ${restant} point(s) à répartir.`
                : `Le barème dépasse de ${-restant} point(s).`}
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={() => setOuvert(!ouvert)}
          className="rounded-md border border-marine-100 bg-white px-3 py-1.5 text-xs"
        >
          {ouvert ? 'Masquer' : 'Ajouter une question'}
        </button>
      </div>

      {ouvert && (
        <div className="space-y-4 rounded-md border border-marine-100 p-4">
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr_10rem]">
            <div>
              <label htmlFor="num" className="mb-1 block text-xs font-medium">
                Numéro
              </label>
              <input
                id="num"
                value={numéro}
                onChange={(e) => setNuméro(e.target.value)}
                className={`${champ} tabulaire`}
              />
            </div>
            <div>
              <label htmlFor="type" className="mb-1 block text-xs font-medium">
                Type
              </label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className={champ}
              >
                {TYPES.map((t) => (
                  <option key={t.valeur} value={t.valeur}>
                    {t.libellé}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pts" className="mb-1 block text-xs font-medium">
                Points
              </label>
              <input
                id="pts"
                type="number"
                step="0.25"
                min={0.25}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
                className={`${champ} tabulaire`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="enonce" className="mb-1 block text-xs font-medium">
              Énoncé
            </label>
            <textarea
              id="enonce"
              rows={2}
              value={énoncé}
              onChange={(e) => setÉnoncé(e.target.value)}
              className={champ}
            />
          </div>

          <div>
            <label htmlFor="corrige" className="mb-1 block text-xs font-medium">
              Corrigé officiel
            </label>
            <textarea
              id="corrige"
              rows={2}
              value={corrigé}
              onChange={(e) => setCorrigé(e.target.value)}
              className={champ}
              placeholder="Fourni par vous. Coteris ne génère jamais de corrigé officiel."
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Critères du barème</span>
              <span
                className={`tabulaire text-xs ${cohérent ? 'text-anthracite-400' : 'text-rouge-fg'}`}
              >
                {sommeCritères} / {points}
              </span>
            </div>

            <div className="space-y-2">
              {critères.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_5rem_1fr_2rem]">
                  <input
                    value={c.label}
                    onChange={(e) => {
                      const copie = [...critères]
                      copie[i] = { ...c, label: e.target.value }
                      setCritères(copie)
                    }}
                    className={champ}
                    placeholder="Intitulé du critère"
                  />
                  <input
                    type="number"
                    step="0.25"
                    min={0.25}
                    value={c.maxPoints}
                    onChange={(e) => {
                      const copie = [...critères]
                      copie[i] = { ...c, maxPoints: Number(e.target.value) }
                      setCritères(copie)
                    }}
                    className={`${champ} tabulaire`}
                  />
                  <input
                    value={c.formulations}
                    onChange={(e) => {
                      const copie = [...critères]
                      copie[i] = { ...c, formulations: e.target.value }
                      setCritères(copie)
                    }}
                    className={champ}
                    placeholder="Formulations acceptées, séparées par ;"
                  />
                  <button
                    type="button"
                    disabled={critères.length === 1}
                    onClick={() => setCritères(critères.filter((_, j) => j !== i))}
                    className="rounded-md border border-marine-100 text-sm disabled:opacity-30"
                    aria-label="Retirer ce critère"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setCritères([...critères, { label: '', maxPoints: 0.25, formulations: '' }])
              }
              className="mt-2 rounded-md border border-marine-100 px-2.5 py-1 text-xs"
            >
              Ajouter un critère
            </button>
          </div>

          <button
            type="button"
            disabled={enCours || !cohérent}
            onClick={ajouterQuestion}
            className="w-full rounded-md bg-marine-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {enCours ? 'Enregistrement…' : 'Ajouter la question'}
          </button>

          {!cohérent && (
            <p className="text-center text-xs text-rouge-fg">
              La somme des critères doit égaler le barème de la question.
            </p>
          )}
        </div>
      )}

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

      {peutVerrouiller && nombreQuestions > 0 && (
        <div className="rounded-md border border-or-500/40 bg-or-100/50 p-4">
          <p className="text-sm font-medium text-or-700">Verrouiller le barème</p>
          <p className="mt-1 text-xs text-anthracite-600">
            Après verrouillage, l’épreuve accepte les copies et plus aucune modification
            directe n’est possible. Le sujet, le corrigé et le barème sont figés, avec leur
            empreinte, votre nom et la date.
          </p>
          <button
            type="button"
            disabled={enCours}
            onClick={verrouillerBarème}
            className="mt-3 rounded-md bg-or-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {enCours ? 'Verrouillage…' : 'Valider et verrouiller'}
          </button>
        </div>
      )}
    </div>
  )
}
