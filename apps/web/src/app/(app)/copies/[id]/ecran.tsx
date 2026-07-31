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
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'

import { BadgeConfiance, Points, formatPoints } from '~/components/ui'
import type { CriterionDecision, QuestionReview } from '~/lib/repositories'
import { validerDécision, validerQuestion } from './actions'

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
          submissionId={copie.id}
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
  submissionId,
  onSurvol,
  peutValider,
  peutFinaliser,
}: {
  question: QuestionReview
  submissionId: string
  onSurvol: (criterionId: string | null) => void
  peutValider: boolean
  peutFinaliser: boolean
}) {
  const router = useRouter()
  const [enCours, démarrer] = useTransition()
  const [erreur, setErreur] = useState<string | null>(null)
  const [enÉdition, setEnÉdition] = useState<string | null>(null)

  const validé = question.decisions.every((d) => d.pointsAwarded !== null)
  const validableEnLot = question.confidenceLevel === 'green' && !validé

  function exécuter(action: () => Promise<{ ok: boolean; message?: string }>) {
    setErreur(null)
    démarrer(async () => {
      const résultat = await action()
      if (!résultat.ok) {
        setErreur(résultat.message ?? 'L’action a échoué.')
        return
      }
      setEnÉdition(null)
      router.refresh()
    })
  }

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

              {peutValider && !d.excluded && (
                <ActionsCritère
                  décision={d}
                  enCours={enCours}
                  ouvert={enÉdition === d.decisionId}
                  onOuvrir={setEnÉdition}
                  onValider={(points, motif) =>
                    exécuter(() =>
                      validerDécision({
                        decisionId: d.decisionId,
                        points,
                        ...(motif.trim() === '' ? {} : { reason: motif.trim() }),
                      }),
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-marine-50 pt-3">
          <span className="text-sm text-anthracite-600">Total proposé</span>
          <span className="tabulaire text-lg font-semibold text-marine-700">
            <Points value={question.totalProposed ?? 0} max={question.maxPoints} />
          </span>
        </div>

        {erreur && (
          <p
            role="alert"
            className="rounded-md border border-rouge-bd bg-rouge-bg px-3 py-2 text-sm text-rouge-fg"
          >
            {erreur}
          </p>
        )}

        {peutValider ? (
          validé ? (
            <p className="rounded-md border border-vert-bd bg-vert-bg px-3 py-2 text-center text-sm text-vert-fg">
              Tous les critères de cette question ont été validés.
            </p>
          ) : (
            <div className="space-y-2">
              {/*
                La validation groupée n'est proposée que sur un cas à confiance
                élevée : c'est la condition posée par le cahier des charges.
                Chaque décision reste consultable, et l'action est auditée comme
                groupée.
              */}
              <button
                type="button"
                disabled={enCours || !validableEnLot}
                onClick={() =>
                  exécuter(() => validerQuestion({ submissionId, questionId: question.questionId }))
                }
                className="w-full rounded-md bg-marine-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-marine-600 disabled:opacity-40"
              >
                {enCours ? 'Enregistrement…' : 'Accepter tous les critères'}
              </button>
              {!validableEnLot && (
                <p className="text-center text-xs text-anthracite-400">
                  Ce cas n’est pas classé en confiance élevée : validez critère par critère.
                </p>
              )}
            </div>
          )
        ) : (
          <p className="rounded-md border border-marine-100 bg-marine-50/40 px-3 py-2 text-center text-sm text-anthracite-600">
            Votre rôle ne permet pas de valider une correction.
          </p>
        )}

        {!peutFinaliser && (
          <p className="text-center text-xs text-anthracite-400">
            La finalisation de la note revient au coordonnateur.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Contrôles de validation d'un critère.
 *
 * Le motif devient obligatoire dès que le correcteur s'écarte de la proposition :
 * le champ apparaît, et le serveur refuse l'enregistrement sans lui. Une note
 * modifiée sans justification est indéfendable devant un jury.
 */
function ActionsCritère({
  décision,
  enCours,
  ouvert,
  onOuvrir,
  onValider,
}: {
  décision: CriterionDecision
  enCours: boolean
  ouvert: boolean
  onOuvrir: (id: string | null) => void
  onValider: (points: number, motif: string) => void
}) {
  const [points, setPoints] = useState(décision.pointsProposed / 1000)
  const [motif, setMotif] = useState('')

  const millipoints = Math.round(points * 1000)
  const modifie = millipoints !== décision.pointsProposed
  const motifManquant = modifie && motif.trim() === ''

  if (!ouvert) {
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={enCours || décision.pointsAwarded !== null}
          onClick={() => onValider(décision.pointsProposed, '')}
          className="rounded-md border border-marine-100 px-2.5 py-1 text-xs font-medium transition hover:bg-marine-50 disabled:opacity-40"
        >
          Accepter
        </button>
        <button
          type="button"
          disabled={enCours}
          onClick={() => onOuvrir(décision.decisionId)}
          className="rounded-md border border-marine-100 px-2.5 py-1 text-xs transition hover:bg-marine-50 disabled:opacity-40"
        >
          Modifier
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-marine-100 bg-marine-50/40 p-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`pts-${décision.decisionId}`} className="text-xs text-anthracite-600">
          Points
        </label>
        <input
          id={`pts-${décision.decisionId}`}
          type="number"
          step="0.25"
          min={0}
          max={décision.pointsPossible / 1000}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className="tabulaire w-20 rounded border border-marine-100 bg-white px-2 py-1 text-xs"
        />
        <span className="text-xs text-anthracite-400">
          sur {formatPoints(décision.pointsPossible)}
        </span>
      </div>

      {modifie && (
        <div>
          <label
            htmlFor={`motif-${décision.decisionId}`}
            className="mb-1 block text-xs text-anthracite-600"
          >
            Motif de la modification (requis)
          </label>
          <input
            id={`motif-${décision.decisionId}`}
            type="text"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Formulation équivalente acceptée"
            className="w-full rounded border border-marine-100 bg-white px-2 py-1 text-xs"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={enCours || motifManquant}
          onClick={() => onValider(millipoints, motif)}
          className="rounded-md bg-marine-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Enregistrer
        </button>
        <button
          type="button"
          disabled={enCours}
          onClick={() => onOuvrir(null)}
          className="rounded-md border border-marine-100 px-2.5 py-1 text-xs"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}
