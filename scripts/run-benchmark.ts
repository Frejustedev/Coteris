/**
 * Exécution du banc d'essai.
 *
 *   pnpm benchmark -- --jeu ./benchmark/data/jeu.json [--pipeline A]
 *
 * Le jeu de données n'est **pas** dans le dépôt et ne doit jamais y entrer :
 * il contient de vraies copies. Voir docs/benchmark-protocol.md.
 *
 * Sans jeu fourni, la commande explique ce qui manque et sort. Elle ne produit
 * jamais de chiffres à partir de données inventées — un résultat fabriqué
 * fausserait la décision la plus importante du projet, celle du fournisseur.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  estSignificatif,
  parseDataset,
  permetDeChoisirUnOcr,
  portéeDuJeu,
  PORTÉE_LABELS,
  évaluer,
  type ObservationCritère,
  type ObservationRéponse,
  type RapportPipeline,
  type RéponseÉvaluation,
} from '@coteris/benchmark'
import {
  createMockTextAnalysisProvider,
  type TextAnalysisProvider,
} from '@coteris/ai'
import { gradeAnswer } from '@coteris/pipeline'
import type { Millipoints } from '@coteris/shared'
import type { QuestionGradingRules, RubricCriterion } from '@coteris/grading'

// --- Pipelines comparés -------------------------------------------------------------

/**
 * Les trois stratégies du cahier des charges.
 *
 * Seul le simulateur est implémenté à ce stade. Les deux autres exigent un
 * fournisseur réel, dont le choix est précisément ce que ce banc d'essai doit
 * éclairer. Les déclarer ici sans les brancher serait mentir sur ce qui est
 * mesurable.
 */
const PIPELINES: Record<string, { description: string; analyzer: () => TextAnalysisProvider }> = {
  mock: {
    description:
      'Correspondance lexicale sur les formulations acceptables. Sert de référence basse ' +
      'et de vérification du harnais, pas de candidat sérieux.',
    analyzer: () => createMockTextAnalysisProvider(),
  },
}

// --- Arguments -----------------------------------------------------------------------

function argument(nom: string): string | undefined {
  const index = process.argv.indexOf(`--${nom}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

// --- Exécution --------------------------------------------------------------------------

/**
 * Traduit un identifiant lisible du jeu en UUID.
 *
 * Le schéma de sortie d'analyse exige des UUID, parce qu'en production les
 * critères en sont. Un jeu d'évaluation, lui, gagne à porter des identifiants
 * lisibles (`syn-k1`) : on les lit dans les rapports d'erreur.
 *
 * Sans cette traduction, chaque analyse était rejetée à la validation du schéma
 * et retombait en « non concluante » — ce qui produisait un rappel de 0 % sans
 * que rien ne signale la vraie cause.
 *
 * La correspondance est déterministe : le même identifiant donne toujours le même
 * UUID, donc deux exécutions restent comparables.
 */
function versUuid(identifiant: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < identifiant.length; i++) {
    h1 = Math.imul(h1 ^ identifiant.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 + identifiant.charCodeAt(i) + i, 0x85ebca6b) >>> 0
  }
  const hex = (n: number, taille: number) => n.toString(16).padStart(8, '0').slice(0, taille)
  return (
    `${hex(h1, 8)}-${hex(h2, 4)}-4${hex(h1 >>> 8, 3)}-` +
    `8${hex(h2 >>> 8, 3)}-${hex(h1, 6)}${hex(h2, 6)}`
  )
}

async function évaluerRéponse(
  réponse: RéponseÉvaluation,
  analyzer: TextAnalysisProvider,
): Promise<ObservationRéponse> {
  const critères: RubricCriterion[] = réponse.critères.map((c, index) => ({
    id: versUuid(c.id) as RubricCriterion['id'],
    questionId: réponse.questionId as RubricCriterion['questionId'],
    label: c.label,
    attribution: 'all_or_nothing',
    pointsMax: c.maxPoints as Millipoints,
    order: index + 1,
    required: false,
    partialRatioPercent: 50,
    expectedElementCount: 0,
    pointsPerElement: null,
    cap: null,
    contradictionPolicy: { kind: 'ignore' },
    factualErrorPenalty: null,
    excludedBy: [],
  }))

  const règles: QuestionGradingRules = {
    questionId: réponse.questionId as QuestionGradingRules['questionId'],
    pointsMax: réponse.pointsMax as Millipoints,
    allowNegative: false,
    roundingStep: null,
    missingRequiredPolicy: { kind: 'none' },
    allowBonusOverflow: false,
  }

  const formulations: Record<string, readonly string[]> = {}
  for (const c of réponse.critères) formulations[versUuid(c.id)] = c.acceptableAnswers

  const début = Date.now()
  const résultat = await gradeAnswer(
    {
      questionPrompt: réponse.question,
      answerKeyText: réponse.corrigé,
      language: 'fr',
      rubricLocked: true,
      criteria: critères,
      acceptableAnswersByCriterion: formulations,
      questionRules: règles,
      // La transcription de référence est utilisée telle quelle : ce banc d'essai
      // mesure l'identification des critères, pas la qualité de l'OCR. Les deux
      // se mesurent séparément, faute de quoi on ne saurait pas laquelle des deux
      // étapes échoue.
      ocr: {
        fullText: réponse.transcriptionRéférence,
        words: [],
        confidence: 0.95,
        engineVersion: 'reference',
      },
    },
    analyzer,
  )
  const duréeMs = Date.now() - début

  type Référence = RéponseÉvaluation['décisionsRéférence'][number]
  const référenceParCritère = new Map<string, Référence>(
    réponse.décisionsRéférence.map((d): [string, Référence] => [versUuid(d.criterionId), d]),
  )
  // On garde le chemin inverse pour que les rapports d'erreur citent
  // l'identifiant lisible du jeu, pas l'UUID interne.
  const lisibleParUuid = new Map(réponse.critères.map((c) => [versUuid(c.id), c.id]))

  const observations: ObservationCritère[] = résultat.outcome.criteria.map((c) => {
    const référence = référenceParCritère.get(c.criterionId as string)
    return {
      criterionId: lisibleParUuid.get(c.criterionId as string) ?? (c.criterionId as string),
      proposé: c.status,
      référence: référence?.référence ?? 'absent',
      pointsProposés: c.pointsComputed,
      pointsRéférence: référence?.pointsRéférence ?? 0,
      niveauConfiance: résultat.confidenceLevel,
    }
  })

  return {
    submissionId: réponse.submissionId,
    questionId: réponse.questionId,
    critères: observations,
    totalProposé: résultat.outcome.total,
    totalRéférence: réponse.totalRéférence,
    pointsMax: réponse.pointsMax,
    niveauConfiance: résultat.confidenceLevel,
    aDemandéValidation: résultat.needsCarefulReview,
    duréeMs,
    // Le simulateur ne coûte rien. Avec un fournisseur réel, le coût viendra de
    // `ai_runs`.
    coûtMicroEur: 0,
    pages: 1,
  }
}

function pourcent(v: number): string {
  return `${(v * 100).toFixed(1)} %`
}

function points(millipoints: number): string {
  return `${(millipoints / 1000).toFixed(3)} pt`
}

function afficher(rapport: RapportPipeline): void {
  console.log(`\n── ${rapport.pipeline} ──────────────────────────────────`)
  console.log(`  portée                   ${PORTÉE_LABELS[rapport.portée]}`)
  console.log(`  réponses évaluées        ${rapport.effectifRéponses}`)
  console.log(`  critères évalués         ${rapport.effectifCritères}`)
  console.log('')
  console.log(`  accord IA-humain         ${pourcent(rapport.accord.taux)}`)
  console.log(`  précision de détection   ${pourcent(rapport.détection.précision)}`)
  console.log(`  rappel de détection      ${pourcent(rapport.détection.rappel)}`)
  console.log(
    `    faux positifs          ${rapport.détection.fauxPositifs}  (points accordés à tort — le plus grave)`,
  )
  console.log(
    `    faux négatifs          ${rapport.détection.fauxNégatifs}  (points refusés à tort)`,
  )
  console.log('')
  console.log(`  erreur absolue moyenne   ${points(rapport.note.erreurAbsolueMoyenne)}`)
  console.log(`  biais                    ${points(rapport.note.biais)}`)
  console.log(`  erreur maximale          ${points(rapport.note.erreurMax)}`)
  console.log(`  notes exactes            ${pourcent(rapport.note.tauxExact)}`)
  console.log('')
  console.log(`  cas verts                ${rapport.confiance.vert}`)
  console.log(`  cas orange               ${rapport.confiance.orange}`)
  console.log(`  cas rouges               ${rapport.confiance.rouge}`)
  console.log(`  validation requise       ${pourcent(rapport.confiance.tauxValidationRequise)}`)
  console.log('')
  console.log(
    `  verts sans modification  ${pourcent(rapport.verts.tauxSansModification)} (sur ${rapport.verts.effectif})`,
  )
  console.log(`  verts corrigés           ${rapport.verts.modifiés}`)
  console.log('')
  console.log(`  durée moyenne            ${rapport.coûts.duréeMoyenneMs.toFixed(0)} ms`)
  console.log(`  coût par copie           ${(rapport.coûts.parCopie / 1_000_000).toFixed(4)} €`)

  if (!estSignificatif(rapport)) {
    console.log('')
    console.log(
      `  ⚠ effectif insuffisant : ${rapport.effectifCritères} critères. Aucune conclusion`,
    )
    console.log('    ne doit être tirée de ces chiffres.')
  }

  if (!permetDeChoisirUnOcr(rapport)) {
    console.log('')
    if (rapport.portée === 'borne_haute') {
      console.log('  ⚠ BORNE HAUTE — les transcriptions étaient parfaites (réponses saisies).')
      console.log('    Ces chiffres mesurent l’identification des critères, PAS la lecture')
      console.log('    manuscrite. Ils ne permettent donc pas de choisir un fournisseur d’OCR.')
      console.log('')
      console.log('    Ce qu’ils disent malgré tout : si l’accord est mauvais ici, sur du texte')
      console.log('    parfait, aucun OCR ne le rattrapera. Une borne haute médiocre est une')
      console.log('    réponse — négative — à la question du produit.')
    } else if (rapport.portée === 'mixte') {
      console.log('  ⚠ JEU MIXTE — manuscrit et saisie sont mélangés. Les chiffres agrégés')
      console.log('    sont une moyenne entre deux choses différentes. Séparez les deux jeux.')
    }
  }
}

async function main(): Promise<void> {
  const chemin = argument('jeu')

  if (!chemin) {
    console.log(`
Banc d'essai Coteris — aucun jeu de données fourni.

  pnpm benchmark -- --jeu ./benchmark/data/jeu.json

Le jeu attendu — 150 à 200 copies anonymisées, 1 000 à 2 000 réponses courtes,
barèmes validés et décisions humaines de référence — n'est pas dans le dépôt et
ne doit jamais y entrer.

Le protocole, le format attendu et la marche à suivre sont dans
docs/benchmark-protocol.md.

Aucun résultat n'est produit sans données réelles : un chiffre fabriqué
fausserait la décision la plus importante du projet, celle du fournisseur.
`)
    return
  }

  const brut = JSON.parse(await readFile(resolve(chemin), 'utf8')) as unknown
  const jeu = parseDataset(brut)

  const portée = portéeDuJeu(jeu.réponses.map((r) => r.origineTranscription))

  console.log(`\nJeu : ${jeu.description}`)
  console.log(`Réponses : ${jeu.réponses.length}`)
  console.log(`Portée : ${PORTÉE_LABELS[portée]}`)

  const demandé = argument('pipeline')
  const àÉvaluer = demandé ? [demandé] : Object.keys(PIPELINES)

  for (const nom of àÉvaluer) {
    const pipeline = PIPELINES[nom]
    if (!pipeline) {
      console.error(`\nPipeline « ${nom} » inconnu. Disponibles : ${Object.keys(PIPELINES).join(', ')}`)
      process.exitCode = 1
      return
    }

    const analyzer = pipeline.analyzer()
    const observations: ObservationRéponse[] = []
    for (const réponse of jeu.réponses) {
      observations.push(await évaluerRéponse(réponse, analyzer))
    }

    afficher(évaluer(nom, observations, portée))
  }

  console.log(
    '\nReportez ces chiffres dans docs/benchmark-results.md, en précisant la date,\n' +
      "le jeu utilisé et sa taille. Un résultat sans ses conditions n'est pas un résultat.\n",
  )
}

main().catch((error: unknown) => {
  console.error('\nÉchec du banc d’essai :', error)
  process.exitCode = 1
})
