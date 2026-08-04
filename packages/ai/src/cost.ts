/**
 * Coût d'inférence et coupe-circuit.
 *
 * Le coût est une **fonctionnalité métier**, pas une métrique d'observabilité.
 * Une plateforme dont le coût par copie dépasse le prix de vente n'a pas de
 * modèle économique.
 *
 * Deux décisions structurantes :
 *
 * 1. **Les coûts sont des entiers, en millionièmes d'euro.** Un appel coûte
 *    parfois 0,0003 € ; additionner des flottants sur des dizaines de milliers
 *    d'appels dérive. Même raison que les points en millièmes.
 *
 * 2. **Le quota est vérifié AVANT l'appel, jamais après.** Compter après ne fait
 *    que constater le dépassement de facture.
 */

declare const brand: unique symbol

/** Montant en millionièmes d'euro. 1 € = 1 000 000. */
export type MicroEur = number & { readonly [brand]: 'MicroEur' }

export const microEur = (value: number): MicroEur => {
  const rounded = Math.round(value)
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError(`Montant hors des entiers sûrs : ${value}`)
  }
  return rounded as MicroEur
}

export const eurToMicro = (eur: number): MicroEur => microEur(eur * 1_000_000)
export const microToEur = (value: MicroEur): number => value / 1_000_000

export const formatEur = (value: MicroEur, locale = 'fr-FR'): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(microToEur(value))

/**
 * Tarif d'un modèle.
 *
 * Versionné et daté : le coût d'une correction de l'an dernier doit rester
 * recalculable avec le tarif en vigueur à l'époque, pas avec le tarif actuel.
 */
export interface ModelPricing {
  readonly provider: string
  readonly model: string
  /** Par million de jetons d'entrée, en millionièmes d'euro. */
  readonly inputPerMillionTokens: MicroEur
  readonly outputPerMillionTokens: MicroEur
  /** Pour les moteurs facturés à la page plutôt qu'au jeton. */
  readonly perPage: MicroEur | null
  readonly effectiveFrom: string
}

/**
 * Taux de conversion dollar vers euro.
 *
 * Les grilles tarifaires des fournisseurs sont publiées en dollars ; la table
 * ci-dessous est en euros, parce que c'est la devise dans laquelle le produit
 * est vendu. La conversion exige donc un taux, et un taux inventé fausserait le
 * modèle de coût aussi sûrement qu'un tarif inventé.
 *
 * Celui-ci est le **taux de référence de la Banque centrale européenne du
 * 31 juillet 2026** : 1 EUR = 1,1485 USD. Source :
 * https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 *
 * Il est figé volontairement. Un taux qui bougerait à chaque appel rendrait
 * incomparables deux corrections faites à un mois d'écart, et le coût par copie
 * ne servirait plus à décider d'un prix de vente. À réviser à la main, en
 * ajoutant une entrée datée plutôt qu'en modifiant les existantes.
 *
 * ⚠️ `findPricing` ignore aujourd'hui `effectiveFrom` : il retient la première
 * ligne trouvée pour un couple fournisseur/modèle. Ajouter un second tarif daté
 * sans corriger cette fonction changerait rétroactivement tout l'historique.
 */
const USD_PAR_EUR = 1.1485

/** Convertit un tarif en dollars par million de jetons vers des micro-euros. */
const usdParMillion = (usd: number): MicroEur => microEur((usd / USD_PAR_EUR) * 1_000_000)

/**
 * Le fournisseur simulé ne coûte rien.
 *
 * Les tarifs réels sont repris des grilles publiées, jamais estimés : un chiffre
 * inventé fausserait tout le modèle de coût, et ce modèle sert à décider du prix
 * de vente.
 */
export const PRICING: readonly ModelPricing[] = [
  {
    provider: 'mock',
    model: 'mock-ocr',
    inputPerMillionTokens: microEur(0),
    outputPerMillionTokens: microEur(0),
    perPage: microEur(0),
    effectiveFrom: '2026-01-01',
  },
  {
    provider: 'mock',
    model: 'mock-analysis',
    inputPerMillionTokens: microEur(0),
    outputPerMillionTokens: microEur(0),
    perPage: null,
    effectiveFrom: '2026-01-01',
  },
  {
    // Grille publiée : 5 $ par million de jetons d'entrée, 25 $ en sortie.
    // https://platform.claude.com/docs/en/about-claude/models/overview
    provider: 'anthropic',
    model: 'claude-opus-5',
    inputPerMillionTokens: usdParMillion(5),
    outputPerMillionTokens: usdParMillion(25),
    perPage: null,
    effectiveFrom: '2026-08-01',
  },
  {
    // Traitement par lot : moitié prix. Le fournisseur porte un nom distinct
    // parce que le TARIF est distinct, et que la table est indexée par le couple
    // (fournisseur, modèle). Facturer un lot au tarif unitaire annulerait dans
    // les comptes l'économie qu'il produit réellement.
    provider: 'anthropic-batch',
    model: 'claude-opus-5',
    inputPerMillionTokens: usdParMillion(2.5),
    outputPerMillionTokens: usdParMillion(12.5),
    perPage: null,
    effectiveFrom: '2026-08-01',
  },
]

export function findPricing(provider: string, model: string): ModelPricing | undefined {
  return PRICING.find((p) => p.provider === provider && p.model === model)
}

export interface UsageForCost {
  readonly provider: string
  readonly model: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly pageCount: number | null
}

/**
 * Calcule le coût d'un appel.
 *
 * Lève si le tarif est inconnu. C'est délibéré : compter un appel à zéro parce
 * que son tarif n'est pas renseigné produirait un modèle de coût faux, et donc
 * un prix de vente faux.
 */
export function computeCost(usage: UsageForCost): MicroEur {
  const pricing = findPricing(usage.provider, usage.model)
  if (!pricing) {
    throw new Error(
      `Tarif inconnu pour ${usage.provider}/${usage.model}. ` +
        `Renseignez-le dans PRICING plutôt que de compter l'appel à zéro.`,
    )
  }

  let total = 0

  if (pricing.perPage !== null && usage.pageCount !== null) {
    total += pricing.perPage * usage.pageCount
  }
  if (usage.inputTokens !== null) {
    total += (pricing.inputPerMillionTokens * usage.inputTokens) / 1_000_000
  }
  if (usage.outputTokens !== null) {
    total += (pricing.outputPerMillionTokens * usage.outputTokens) / 1_000_000
  }

  return microEur(total)
}

// --- Coupe-circuit -----------------------------------------------------------

export interface QuotaState {
  readonly organizationId: string
  /** Dépense du mois en cours. */
  readonly spentThisMonth: MicroEur
  readonly monthlyBudget: MicroEur
  /** Dépense sur l'épreuve concernée. */
  readonly spentOnAssessment: MicroEur
  readonly perAssessmentBudget: MicroEur
  /** Suspension manuelle par un administrateur. */
  readonly suspended: boolean
  readonly suspensionReason: string | null
}

export type QuotaDecision =
  | { readonly allowed: true; readonly remainingThisMonth: MicroEur }
  | { readonly allowed: false; readonly reason: string; readonly code: QuotaRefusalCode }

export type QuotaRefusalCode =
  | 'suspended'
  | 'monthly_budget_exhausted'
  | 'assessment_budget_exhausted'
  | 'would_exceed_monthly_budget'
  | 'would_exceed_assessment_budget'

/**
 * Autorise ou refuse un appel, **avant** qu'il ne soit émis.
 *
 * @param estimatedCost Coût estimé de l'appel à venir. Un appel qui ferait
 *   dépasser le budget est refusé, pas seulement signalé après coup.
 */
export function checkQuota(state: QuotaState, estimatedCost: MicroEur): QuotaDecision {
  if (state.suspended) {
    return {
      allowed: false,
      code: 'suspended',
      reason:
        state.suspensionReason ??
        "Les traitements d'intelligence artificielle sont suspendus pour cette organisation.",
    }
  }

  if (state.spentThisMonth >= state.monthlyBudget) {
    return {
      allowed: false,
      code: 'monthly_budget_exhausted',
      reason:
        `Le budget mensuel de ${formatEur(state.monthlyBudget)} est atteint ` +
        `(${formatEur(state.spentThisMonth)} dépensés).`,
    }
  }

  if (state.spentOnAssessment >= state.perAssessmentBudget) {
    return {
      allowed: false,
      code: 'assessment_budget_exhausted',
      reason:
        `Le budget de cette épreuve, ${formatEur(state.perAssessmentBudget)}, est atteint.`,
    }
  }

  if (state.spentThisMonth + estimatedCost > state.monthlyBudget) {
    return {
      allowed: false,
      code: 'would_exceed_monthly_budget',
      reason:
        `Cet appel, estimé à ${formatEur(estimatedCost)}, dépasserait le budget ` +
        `mensuel de ${formatEur(state.monthlyBudget)}.`,
    }
  }

  if (state.spentOnAssessment + estimatedCost > state.perAssessmentBudget) {
    return {
      allowed: false,
      code: 'would_exceed_assessment_budget',
      reason:
        `Cet appel, estimé à ${formatEur(estimatedCost)}, dépasserait le budget ` +
        `de l'épreuve, fixé à ${formatEur(state.perAssessmentBudget)}.`,
    }
  }

  return {
    allowed: true,
    remainingThisMonth: microEur(state.monthlyBudget - state.spentThisMonth - estimatedCost),
  }
}

export class QuotaExceededError extends Error {
  readonly code: QuotaRefusalCode

  constructor(decision: Extract<QuotaDecision, { allowed: false }>) {
    super(decision.reason)
    this.name = 'QuotaExceededError'
    this.code = decision.code
  }
}
