/**
 * Estimation du coût d'un appel, **avant** de l'émettre.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `checkQuota` exige un coût estimé : « le quota est vérifié AVANT l'appel,
 * jamais après », parce que compter après ne fait que constater le dépassement
 * de facture. Mais `ProviderUsage` n'existe qu'APRÈS l'appel, et l'interface
 * `TextAnalysisProvider` ne propose rien d'autre. Le principe était donc
 * structurellement inapplicable.
 *
 * LE PARTI PRIS : SURESTIMER
 *
 * Un garde-fou qui sous-estime laisse dépasser le budget — c'est exactement ce
 * qu'il devait empêcher. Il vaut mieux refuser un appel qui serait passé de
 * justesse que d'en laisser passer un qui ne le devait pas : le premier cas se
 * corrige en relevant le plafond, le second se découvre sur la facture.
 *
 * Chaque constante ci-dessous arrondit donc dans le sens défavorable, et la
 * comptabilité réelle — elle — se fait sur l'usage rapporté par le fournisseur
 * après coup. L'estimation sert à décider, pas à facturer.
 */

import type { AnalysisRequest } from './providers'
import type { UsageForCost } from './cost'

/**
 * Caractères par jeton, en français.
 *
 * L'ordre de grandeur usuel se situe entre 3,5 et 4 pour du français courant. On
 * retient 3, plus pessimiste : le texte d'un examen est dense en sigles, en
 * nombres et en ponctuation, tous coûteux en jetons.
 */
const CARACTERES_PAR_JETON = 3

/**
 * Jetons de sortie supposés par analyse.
 *
 * Mesuré sur 208 réponses réelles (GSS4408, `claude-opus-5`, effort medium) :
 * environ 1300 jetons de sortie par analyse, raisonnement compris. On retient
 * 2000 : une question à nombreux critères, chacun accompagné de ses extraits
 * justificatifs, dépasse largement la moyenne.
 */
const JETONS_SORTIE_SUPPOSES = 2000

/** Surcoût de l'invite système, constante pour toutes les analyses. */
const JETONS_INVITE_SYSTEME = 700

/**
 * Estime la consommation d'une analyse à venir.
 *
 * @param expectedOutputTokens Permet d'affiner à partir de mesures propres à un
 *   barème. Par défaut, une valeur volontairement haute.
 */
export function estimateUsageFor(
  request: AnalysisRequest,
  provider: string,
  model: string,
  expectedOutputTokens: number = JETONS_SORTIE_SUPPOSES,
): UsageForCost {
  const caracteres =
    request.questionPrompt.length +
    request.answerKeyText.length +
    request.transcription.length +
    request.criteria.reduce(
      (total, critere) =>
        total +
        critere.label.length +
        (critere.description?.length ?? 0) +
        critere.acceptableAnswers.reduce((n, a) => n + a.length, 0),
      0,
    )

  return {
    provider,
    model,
    inputTokens: Math.ceil(caracteres / CARACTERES_PAR_JETON) + JETONS_INVITE_SYSTEME,
    outputTokens: expectedOutputTokens,
    pageCount: null,
  }
}
