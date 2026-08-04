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
  GRANULARITÉ_LABELS,
  PORTÉE_LABELS,
  type Granularité,
  évaluer,
  type ObservationCritère,
  type ObservationRéponse,
  type RapportPipeline,
  type RéponseÉvaluation,
} from '@coteris/benchmark'
import {
  computeCost,
  createAnthropicTextAnalysisProvider,
  createMockTextAnalysisProvider,
  microEur,
  MODELE_PAR_DEFAUT,
  supportsBatch,
  type BatchAnalysisOutcome,
  type DiagnosticAnalyse,
  type TextAnalysisProvider,
} from '@coteris/ai'
import { analysisRequestFor, gradeAnswer, type GradeAnswerInput } from '@coteris/pipeline'
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
/**
 * Réparations et anomalies rapportées par le fournisseur sur l'exécution en cours.
 *
 * Un fournisseur qui hallucine régulièrement ses citations serait autrement
 * indiscernable d'un fournisseur exact : ses extraits fabriqués sont retirés en
 * silence, ses critères sans preuve rétrogradés en absents, et seul le rappel
 * baisserait — sans que rien n'en désigne la cause.
 */
const diagnostics: DiagnosticAnalyse[] = []

const PIPELINES: Record<string, { description: string; analyzer: () => TextAnalysisProvider }> = {
  mock: {
    description:
      'Correspondance lexicale sur les formulations acceptables. Sert de référence basse ' +
      'et de vérification du harnais, pas de candidat sérieux.',
    analyzer: () => createMockTextAnalysisProvider(),
  },
  anthropic: {
    description:
      "Analyse par modèle de langage, sorties structurées et raisonnement adaptatif. " +
      'Exige AI_API_KEY ; chaque exécution est facturée.',
    analyzer: () =>
      createAnthropicTextAnalysisProvider({
        apiKey: process.env['AI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'] ?? '',
        model: process.env['AI_MODEL'] ?? MODELE_PAR_DEFAUT,
        // Le raisonnement est facturé comme de la sortie, et c'est lui qui
        // domine la facture. L'effort est donc le principal levier de coût du
        // banc d'essai — et un paramètre à balayer, pas une constante : la
        // question « quelle qualité pour quel prix » ne se tranche que par
        // mesure sur le même échantillon.
        effort: EFFORT,
        onDiagnostic: (d) => diagnostics.push(d),
      }),
  },
}

// --- Arguments -----------------------------------------------------------------------

function argument(nom: string): string | undefined {
  const index = process.argv.indexOf(`--${nom}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

function effortDemandé(): Effort {
  const brut = argument('effort') ?? 'high'
  const trouvé = EFFORTS.find((e) => e === brut)
  if (!trouvé) {
    throw new Error(`Effort « ${brut} » inconnu. Valeurs : ${EFFORTS.join(', ')}.`)
  }
  return trouvé
}

const EFFORT = effortDemandé()

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

/**
 * Construit l'entrée de correction d'une réponse du jeu.
 *
 * Séparée de l'évaluation parce que la pré-passe par lot en a besoin : elle doit
 * préparer exactement les mêmes demandes que celles qui seront jouées ensuite,
 * sans quoi le lot mesurerait autre chose que le chemin unitaire.
 */
function entréePour(réponse: RéponseÉvaluation): GradeAnswerInput {
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

  return {
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
      // La transcription de référence n'a pas été LUE : elle est saisie. Il n'y
      // a donc aucune incertitude de lecture. Toute valeur inférieure à 1
      // serait un plafond fantôme : dans le calcul de confiance, l'OCR est un
      // plafond MULTIPLICATIF, et un 0,95 arbitraire écrêterait la confiance de
      // tous les pipelines de la même façon — donc fausserait la comparaison
      // entre eux, qui est l'unique objet de ce banc d'essai.
      confidence: 1,
      engineVersion: 'reference',
    },
  }
}

/**
 * Fournisseur qui restitue des analyses déjà obtenues par lot.
 *
 * Le pipeline reste identique : il appelle `analyze()` sans savoir que la
 * réponse était déjà là. Mesurer le lot autrement — en court-circuitant le
 * pipeline — reviendrait à mesurer un autre produit que celui qu'on livre.
 *
 * L'indexation se fait sur la demande sérialisée, jamais sur un compteur
 * d'appels : le pipeline n'appelle pas le modèle pour une copie blanche, et un
 * compteur se décalerait dès la première, attribuant ensuite chaque analyse à la
 * mauvaise copie.
 */
function fournisseurPréCalculé(
  nom: string,
  issues: ReadonlyMap<string, BatchAnalysisOutcome>,
): TextAnalysisProvider {
  return {
    name: nom,
    analyze(request) {
      const issue = issues.get(JSON.stringify(request))
      if (issue === undefined) {
        return Promise.reject(
          new Error("Cette demande n'a pas été soumise au lot : incohérence du harnais."),
        )
      }
      if (issue.response === null) {
        return Promise.reject(issue.error ?? new Error('Analyse absente du lot.'))
      }
      return Promise.resolve(issue.response)
    },
  }
}

async function évaluerRéponse(
  réponse: RéponseÉvaluation,
  analyzer: TextAnalysisProvider,
): Promise<ObservationRéponse> {
  const début = Date.now()
  const résultat = await gradeAnswer(entréePour(réponse), analyzer)

  // La durée rapportée par le fournisseur prime sur le temps mesuré ici. En mode
  // lot, l'analyse a été obtenue avant cette boucle : le chronomètre local ne
  // mesurerait que la restitution d'un résultat déjà en mémoire, et le rapport
  // annoncerait quelques millisecondes pour un travail de plusieurs minutes.
  const duréeMs = résultat.usage?.durationMs ?? Date.now() - début

  const observations = construireObservations(réponse, résultat)

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
    // Le coût vient de la consommation rapportée par le fournisseur. Laisser un
    // zéro en dur ferait afficher « 0,0000 € par copie » pour un modèle facturé,
    // alors que le protocole fait du coût par copie un critère de décision.
    coûtMicroEur: résultat.usage === null ? microEur(0) : computeCost(résultat.usage),
    pages: 1,
  }
}

/** Déduit un état à partir de points obtenus sur un maximum. */
function étatDepuisPoints(points: number, max: number): 'present' | 'partial' | 'absent' {
  if (points <= 0) return 'absent'
  if (points >= max) return 'present'
  return 'partial'
}

/**
 * Construit les observations comparables, selon la finesse de la référence.
 *
 * Quand le correcteur n'a mis qu'une note globale à la question, on ne peut pas
 * comparer critère par critère : on compare les **totaux**, en traitant la
 * question comme une seule observation. Répartir la note entre les critères
 * pour obtenir une comparaison plus fine reviendrait à inventer la référence.
 */
function construireObservations(
  réponse: RéponseÉvaluation,
  résultat: Awaited<ReturnType<typeof gradeAnswer>>,
): ObservationCritère[] {
  if (réponse.niveauRéférence === 'question') {
    return [
      {
        criterionId: réponse.questionId,
        proposé: étatDepuisPoints(résultat.outcome.total, réponse.pointsMax),
        référence: étatDepuisPoints(réponse.totalRéférence, réponse.pointsMax),
        pointsProposés: résultat.outcome.total,
        pointsRéférence: réponse.totalRéférence,
        niveauConfiance: résultat.confidenceLevel,
      },
    ]
  }

  type Référence = RéponseÉvaluation['décisionsRéférence'][number]
  const parCritère = new Map<string, Référence>(
    réponse.décisionsRéférence.map((d): [string, Référence] => [versUuid(d.criterionId), d]),
  )
  // Chemin inverse : les rapports d'erreur citent l'identifiant lisible du jeu,
  // pas l'UUID interne.
  const lisible = new Map(réponse.critères.map((c) => [versUuid(c.id), c.id]))

  return résultat.outcome.criteria.map((c) => {
    const référence = parCritère.get(c.criterionId as string)
    return {
      criterionId: lisible.get(c.criterionId as string) ?? (c.criterionId as string),
      proposé: c.status,
      référence: référence?.référence ?? 'absent',
      pointsProposés: c.pointsComputed,
      pointsRéférence: référence?.pointsRéférence ?? 0,
      niveauConfiance: résultat.confidenceLevel,
    }
  })
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
      console.log('  ⚠ BORNE HAUTE — réponses saisies, donc sans incertitude de lecture.')
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

  // Un jeu mélangeant les deux finesses de référence n'est pas comparable :
  // on retient la plus grossière, qui est celle qui limite l'interprétation.
  const granularité: Granularité = jeu.réponses.some((r) => r.niveauRéférence === 'question')
    ? 'question'
    : 'critère'

  console.log(`\nJeu : ${jeu.description}`)
  console.log(`Réponses : ${jeu.réponses.length}`)
  console.log(`Portée : ${PORTÉE_LABELS[portée]}`)
  console.log(`Comparaison : ${GRANULARITÉ_LABELS[granularité]}`)
  console.log(`Effort : ${EFFORT}`)

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
    diagnostics.length = 0

    // `--limite N` borne l'exécution aux N premières réponses. Avec un
    // fournisseur facturé, lancer 208 appels pour découvrir au dixième que la
    // clé est absente ou le schéma refusé serait un gâchis évitable. Les
    // métriques d'un échantillon ne sont pas publiables — le rapport le dit.
    const limite = Number(argument('limite') ?? jeu.réponses.length)
    const àTraiter = jeu.réponses.slice(0, limite)
    if (àTraiter.length < jeu.réponses.length) {
      console.log(
        `\n⚠ ÉCHANTILLON : ${àTraiter.length} réponses sur ${jeu.réponses.length}. ` +
          'Ces chiffres servent à vérifier le harnais, pas à décider.',
      )
    }

    // Pré-passe par lot quand le fournisseur la propose : même travail, moitié
    // prix. On n'y soumet que les réponses non vides — le pipeline n'appelle pas
    // le modèle pour une copie blanche, et payer pour une analyse qui ne sera
    // jamais demandée serait une dépense pure.
    let effectif: TextAnalysisProvider = analyzer
    if (supportsBatch(analyzer) && argument('lot') !== 'non') {
      const àAnalyser = àTraiter.filter((r) => r.transcriptionRéférence.trim().length > 0)
      console.log(
        `\nSoumission par lot : ${àAnalyser.length} analyses ` +
          `(${àTraiter.length - àAnalyser.length} copie(s) blanche(s) écartée(s)).`,
      )
      const demandes = àAnalyser.map((r) => analysisRequestFor(entréePour(r)))
      const issues = await analyzer.analyzeBatch(demandes, (m) => {
        console.log(`  ${m}`)
      })
      const parDemande = new Map<string, BatchAnalysisOutcome>()
      demandes.forEach((demande, i) => {
        const issue = issues[i]
        if (issue !== undefined) parDemande.set(JSON.stringify(demande), issue)
      })
      effectif = fournisseurPréCalculé(analyzer.name, parDemande)
    }

    const observations: ObservationRéponse[] = []
    const échecs: { réponse: string; raison: string }[] = []

    for (const réponse of àTraiter) {
      try {
        observations.push(await évaluerRéponse(réponse, effectif))
      } catch (error) {
        // Un fournisseur réel échoue : refus du modèle, sortie non conforme
        // après reprise, coupure réseau. Sans ce filet, une seule réponse en
        // échec interromprait une exécution de plusieurs centaines d'appels
        // déjà facturés.
        //
        // L'échec est COMPTÉ ET EXCLU, jamais converti en note de zéro : le
        // compter comme un zéro reviendrait à imputer au fournisseur une erreur
        // de correction là où il a refusé de conclure. C'est précisément la
        // confusion que ce banc d'essai doit éviter.
        échecs.push({
          réponse: `${réponse.submissionId}/${réponse.questionId}`,
          raison: error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error),
        })
      }
    }

    if (échecs.length > 0) {
      console.log(
        `\n⚠ ${échecs.length} réponse(s) en échec, EXCLUES des métriques ` +
          `(${((échecs.length / àTraiter.length) * 100).toFixed(1)} % des réponses traitées) :`,
      )
      for (const é of échecs.slice(0, 10)) console.log(`   ${é.réponse} — ${é.raison}`)
      if (échecs.length > 10) console.log(`   … et ${échecs.length - 10} autre(s).`)
      console.log(
        '  Un taux d’échec élevé disqualifie un fournisseur autant qu’un mauvais accord :\n' +
          "  les métriques ci-dessous ne portent que sur les réponses qu'il a acceptées.",
      )
    }

    if (diagnostics.length > 0) {
      const parType = new Map<string, number>()
      for (const d of diagnostics) parType.set(d.type, (parType.get(d.type) ?? 0) + 1)
      console.log('\nRéparations appliquées à la sortie du modèle :')
      for (const [type, n] of [...parType].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${type.padEnd(22)} ${n}`)
      }
      const fabriques = parType.get('extrait_fabrique') ?? 0
      if (fabriques > 0) {
        console.log(
          `  ⚠ ${fabriques} citation(s) introuvable(s) dans la copie. Une preuve inventée est\n` +
            "  le mode d'erreur le plus dangereux du produit : elle est indiscernable d'une\n" +
            "  vraie preuve à l'œil nu.",
        )
      }
    }

    afficher(évaluer(nom, observations, portée, granularité))
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
