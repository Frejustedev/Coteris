'use client'

/**
 * Écran de correction à trois zones.
 *
 *   gauche   — la copie : image de la zone analysée
 *   centre   — la réponse : transcription, avec les passages justificatifs surlignés
 *   droite   — la notation : critères, points proposés, preuves, confiance, actions
 *
 * Le principe qui gouverne cet écran : **rien n'est présenté sans sa preuve**.
 * Chaque point proposé affiche l'extrait exact de la copie qui le justifie, et
 * survoler un critère surligne ce passage dans la transcription.
 *
 * Piloté au clavier : un correcteur enchaîne des centaines de réponses.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { BadgeConfiance, Points, formatPoints } from '~/components/ui'
import type { QuestionReview } from '~/lib/repositories'

interface Copie {
  id: string
  anonymousCode: string
  quality: string | null
  assessmentId: string
  assessmentTitle: string
}

export function ÉcranCorrection({
  copie,
  questions,
  peutValider,
  peutFinaliser,
}: {
  copie: Copie
  questions: QuestionReview[]
  peutValider: boolean
  peutFinaliser: boolean
}) {
  const [index, setIndex] = useState(0)
  const [critèreSurvolé, setCritèreSurvolé] = useState<string | null>(null)

  const question = questions[index]

  const suivante = useCallback(
    () => setIndex((i) => Math.min(i + 1, questions.length - 1)),
    [questions.length],
  )
  const précédente = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  // Raccourcis clavier. Ignorés dès qu'un champ de saisie a le focus, sinon
  // taper « j » dans un commentaire ferait sauter de question.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const cible = event.target as HTMLElement | null
      if (cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        suivante()
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        précédente()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [suivante, précédente])

  const totalProposé = useMemo(
    () => questions.reduce((somme, q) => somme + (q.totalProposed ?? 0), 0),
    [questions],
  )
  const totalMax = useMemo(() => questions.reduce((somme, q) => somme + q.maxPoints, 0), [questions])

  if (!question) {
    return <p className="text-sm text-anthracite-600">Cette copie ne contient aucune réponse.</p>
  }

  const extraitsSurlignés =
    critèreSurvolé === null
      ? []
      : (question.decisions.find((d) => d.criterionId === critèreSurvolé)?.evidence ?? [])

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/epreuves/${copie.assessmentId}`}
            className="text-sm text-anthracite-400 hover:text-marine-600"
          >
            ← {copie.assessmentTitle}
          </Link>
          <h1 className="tabulaire mt-1 font-titre text-xl font-semibold text-marine-700">
            {copie.anonymousCode}
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-anthracite-400">
              Total proposé
            </p>
            <p className="tabulaire text-lg font-semibold text-marine-700">
              <Points value={totalProposé} max={totalMax} />
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={précédente}
              disabled={index === 0}
              className="rounded-md border border-marine-100 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={suivante}
              disabled={index === questions.length - 1}
              className="rounded-md border border-marine-100 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              ↓
            </button>
          </div>
        </div>
      </div>

      {/* Sélecteur de questions */}
      <nav className="flex flex-wrap gap-1.5" aria-label="Questions">
        {questions.map((q, i) => (
          <button
            key={q.questionId}
            type="button"
            onClick={() => setIndex(i)}
            aria-current={i === index}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition ${
              i === index
                ? 'border-marine-600 bg-marine-700 text-white'
                : 'border-marine-100 bg-white hover:border-petrole-300'
            }`}
          >
            <span className="tabulaire">Q{q.number}</span>
            {q.confidenceLevel && (
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  q.confidenceLevel === 'green'
                    ? 'bg-vert-fg'
                    : q.confidenceLevel === 'orange'
                      ? 'bg-orange-fg'
                      : 'bg-rouge-fg'
                }`}
              />
            )}
          </button>
        ))}
      </nav>

      {/* Trois zones */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)]">
        <ZoneCopie question={question} code={copie.anonymousCode} />
        <ZoneRéponse question={question} extraitsSurlignés={extraitsSurlignés} />
        <ZoneNotation
          question={question}
          onSurvol={setCritèreSurvolé}
          peutValider={peutValider}
          peutFinaliser={peutFinaliser}
        />
      </div>

      <p className="text-center text-xs text-anthracite-400">
        Raccourcis : <kbd className="tabulaire">j</kbd> / <kbd className="tabulaire">k</kbd> pour
        naviguer entre les questions.
      </p>
    </div>
  )
}

// --- Zone gauche : la copie ---------------------------------------------------

function ZoneCopie({ question, code }: { question: QuestionReview; code: string }) {
  return (
    <section className="rounded-lg border border-marine-100 bg-white">
      <header className="border-b border-marine-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-marine-700">Copie</h2>
      </header>
      <div className="p-4">
        {/*
          Le stockage des images n'est pas encore implémenté : on affiche la
          référence de la zone plutôt qu'une image d'illustration trompeuse.
        */}
        <div className="flex aspect-4/3 flex-col items-center justify-center rounded-md border border-dashed border-marine-100 bg-marine-50/40 px-4 text-center">
          <p className="text-sm text-anthracite-600">Zone de réponse recadrée</p>
          <p className="tabulaire mt-2 text-xs break-all text-anthracite-400">
            {question.regionImageKey ?? 'aucune zone associée'}
          </p>
          <p className="mt-3 text-xs text-anthracite-400">
            L’affichage de l’image nécessite la couche de stockage, non encore implémentée.
          </p>
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-anthracite-400">Copie</dt>
            <dd className="tabulaire">{code}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-anthracite-400">Confiance de lecture</dt>
            <dd className="tabulaire">
              {question.ocrConfidence === null
                ? '—'
                : `${Math.round(question.ocrConfidence * 100)} %`}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

// --- Zone centrale : la réponse ------------------------------------------------

/**
 * Surligne les extraits justificatifs dans la transcription.
 *
 * La comparaison est faite sur le texte brut, sans normalisation : les extraits
 * proviennent de la copie elle-même, une correspondance exacte est donc attendue.
 * S'il n'y a pas correspondance, on n'affiche simplement aucun surlignage plutôt
 * que d'en inventer un approximatif.
 */
function surligner(texte: string, extraits: readonly string[]) {
  if (extraits.length === 0) return [{ texte, surligné: false }]

  const positions: { début: number; fin: number }[] = []
  for (const extrait of extraits) {
    const début = texte.indexOf(extrait)
    if (début !== -1) positions.push({ début, fin: début + extrait.length })
  }
  if (positions.length === 0) return [{ texte, surligné: false }]

  positions.sort((a, b) => a.début - b.début)

  const morceaux: { texte: string; surligné: boolean }[] = []
  let curseur = 0
  for (const p of positions) {
    if (p.début < curseur) continue
    if (p.début > curseur) morceaux.push({ texte: texte.slice(curseur, p.début), surligné: false })
    morceaux.push({ texte: texte.slice(p.début, p.fin), surligné: true })
    curseur = p.fin
  }
  if (curseur < texte.length) morceaux.push({ texte: texte.slice(curseur), surligné: false })

  return morceaux
}

function ZoneRéponse({
  question,
  extraitsSurlignés,
}: {
  question: QuestionReview
  extraitsSurlignés: readonly string[]
}) {
  const morceaux = surligner(question.transcription, extraitsSurlignés)

  return (
    <section className="rounded-lg border border-marine-100 bg-white">
      <header className="flex items-center justify-between border-b border-marine-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-marine-700">Réponse</h2>
        <span className="text-xs text-anthracite-400">Transcription</span>
      </header>
      <div className="p-4">
        {question.transcription.trim() === '' ? (
          <p className="rounded-md border border-dashed border-marine-100 bg-marine-50/40 px-4 py-8 text-center text-sm text-anthracite-600">
            Aucun texte lisible dans cette zone.
            <br />
            <span className="text-xs text-anthracite-400">
              Aucune proposition de points n’a été faite.
            </span>
          </p>
        ) : (
          <p className="text-[0.95rem] leading-relaxed">
            {morceaux.map((m, i) =>
              m.surligné ? (
                <mark key={i} className="rounded bg-or-100 px-0.5 text-anthracite-800">
                  {m.texte}
                </mark>
              ) : (
                <span key={i}>{m.texte}</span>
              ),
            )}
          </p>
        )}

        {question.warnings.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {question.warnings.map((a, i) => (
              <li
                key={i}
                className="rounded-md border border-orange-bd bg-orange-bg px-3 py-1.5 text-xs text-orange-fg"
              >
                {a}
              </li>
            ))}
          </ul>
        )}

        {question.unexpectedElements.length > 0 && (
          <div className="mt-4 rounded-md border border-or-500/40 bg-or-100/60 p-3">
            <p className="text-xs font-semibold text-or-700">
              Réponse correcte non prévue au corrigé
            </p>
            {question.unexpectedElements.map((e, i) => (
              <div key={i} className="mt-2 text-xs">
                <p className="italic text-anthracite-800">« {e.excerpt} »</p>
                <p className="mt-0.5 text-anthracite-600">{e.explanation}</p>
              </div>
            ))}
            <p className="mt-2 text-xs text-anthracite-600">
              Le correcteur doit trancher. Accepter cette formulation créera une nouvelle
              version du corrigé, jamais une modification silencieuse.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// --- Zone droite : la notation --------------------------------------------------

function ZoneNotation({
  question,
  onSurvol,
  peutValider,
  peutFinaliser,
}: {
  question: QuestionReview
  onSurvol: (criterionId: string | null) => void
  peutValider: boolean
  peutFinaliser: boolean
}) {
  const validé = question.decisions.every((d) => d.pointsAwarded !== null)

  return (
    <section className="rounded-lg border border-marine-100 bg-white">
      <header className="flex items-center justify-between border-b border-marine-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-marine-700">Notation</h2>
        <BadgeConfiance niveau={question.confidenceLevel} score={question.confidence} />
      </header>

      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-anthracite-400">
            Question {question.number}
          </p>
          <p className="mt-1 text-sm">{question.prompt}</p>
        </div>

        {question.answerKey && (
          <details className="rounded-md border border-marine-50 bg-marine-50/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-marine-600">
              Corrigé attendu
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-anthracite-600">
              {question.answerKey}
            </p>
          </details>
        )}

        <ul className="space-y-2">
          {question.decisions.map((d) => (
            <li
              key={d.decisionId}
              onMouseEnter={() => onSurvol(d.criterionId)}
              onMouseLeave={() => onSurvol(null)}
              className={`rounded-md border px-3 py-2 transition ${
                d.pointsProposed > 0
                  ? 'border-vert-bd bg-vert-bg/40'
                  : 'border-marine-100 bg-white'
              } ${d.excluded ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{d.label}</p>
                <span className="tabulaire shrink-0 text-sm">
                  {formatPoints(d.pointsProposed)}
                  <span className="text-anthracite-400"> / {formatPoints(d.pointsPossible)}</span>
                </span>
              </div>

              {d.evidence.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {d.evidence.map((e, i) => (
                    <li key={i} className="text-xs italic text-anthracite-600">
                      « {e} »
                    </li>
                  ))}
                </ul>
              )}

              {d.deniedForMissingEvidence && (
                <p className="mt-1.5 text-xs text-rouge-fg">
                  Aucun extrait justificatif : le critère est laissé à zéro.
                </p>
              )}

              {d.excluded && (
                <p className="mt-1.5 text-xs text-anthracite-400">
                  Critère exclu par un autre critère attribué.
                </p>
              )}

              {d.appliedRules.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-anthracite-400">
                    Règles appliquées
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {d.appliedRules.map((r, i) => (
                      <li key={i} className="text-xs text-anthracite-600">
                        {r.detail}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="mt-1.5 text-xs text-anthracite-400">
                {d.pointsAwarded === null
                  ? 'En attente de validation humaine'
                  : `Validé à ${formatPoints(d.pointsAwarded)} point(s)`}
              </p>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-marine-50 pt-3">
          <span className="text-sm text-anthracite-600">Total proposé</span>
          <span className="tabulaire text-lg font-semibold text-marine-700">
            <Points value={question.totalProposed ?? 0} max={question.maxPoints} />
          </span>
        </div>

        {/*
          Les actions ne sont pas encore câblées : les afficher actives donnerait
          l'illusion d'un produit terminé. Elles sont désactivées et le disent.
        */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled
            title="Non encore implémenté"
            className="rounded-md bg-marine-700 px-3 py-2 text-sm font-medium text-white opacity-40"
          >
            {validé ? 'Déjà validé' : 'Accepter'}
          </button>
          <button
            type="button"
            disabled
            title="Non encore implémenté"
            className="rounded-md border border-marine-100 px-3 py-2 text-sm opacity-40"
          >
            Modifier
          </button>
        </div>

        <p className="text-center text-xs text-anthracite-400">
          {peutValider
            ? 'Validation et modification : non encore implémentées.'
            : 'Votre rôle ne permet pas de valider une correction.'}
          {peutFinaliser ? '' : ' La finalisation revient au coordonnateur.'}
        </p>
      </div>
    </section>
  )
}
