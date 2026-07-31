/**
 * Types du moteur de barème.
 *
 * Frontière fondamentale du produit :
 *
 *   L'IA identifie des ÉTATS.  Le moteur calcule des POINTS.
 *
 * Un modèle de langage ne doit jamais produire une note. Il produit un
 * `CriterionAssessment` — « ce critère est présent, partiel ou absent, et voici
 * l'extrait qui le montre ». Le moteur, lui, est du code ordinaire : déterministe,
 * relu, testé, et capable d'expliquer chaque millième attribué.
 *
 * C'est ce qui rend une note défendable devant un jury.
 */

import type { Millipoints, QuestionId, RubricCriterionId } from '@coteris/shared'

/** Mode d'attribution des points d'un critère. */
export type AttributionType =
  /** Tout ou rien : les points entiers, ou zéro. Une réponse partielle ne vaut rien. */
  | 'all_or_nothing'
  /** Partiel : les points entiers si présent, une fraction si partiellement présent. */
  | 'partial'
  /** Points par élément : n points par élément cité, dans la limite d'un plafond. */
  | 'per_element'
  /** Score manuel : le correcteur fixe la valeur, l'IA ne propose rien. */
  | 'manual'
  /** Bonus : points ajoutés au-delà du barème nominal. */
  | 'bonus'
  /** Pénalité : le critère décrit une erreur ; sa présence retire des points. */
  | 'penalty'

/**
 * État d'un critère dans une réponse, tel qu'identifié par l'analyse.
 *
 * C'est la seule information que l'IA fournit au moteur. Elle ne fournit jamais
 * de points.
 */
export type CriterionStatus =
  /** L'élément attendu est présent et correct. */
  | 'present'
  /** L'élément est abordé mais incomplet ou imprécis. */
  | 'partial'
  /** L'élément est absent de la réponse. */
  | 'absent'

/** Traitement d'une contradiction sur un critère. */
export type ContradictionPolicy =
  /** La contradiction n'affecte pas les points. */
  | { readonly kind: 'ignore' }
  /** Le critère tombe à zéro. */
  | { readonly kind: 'zero' }
  /** Le critère est plafonné à un pourcentage de sa valeur. */
  | { readonly kind: 'cap_percent'; readonly percent: number }
  /** Un montant fixe est retiré. */
  | { readonly kind: 'penalty'; readonly amount: Millipoints }

/** Traitement de l'absence d'un critère déclaré obligatoire. */
export type MissingRequiredPolicy =
  /** Aucune conséquence au-delà de la perte des points du critère. */
  | { readonly kind: 'none' }
  /** La question entière tombe à zéro. */
  | { readonly kind: 'zero_question' }
  /** La question est plafonnée à un pourcentage de son total. */
  | { readonly kind: 'cap_percent'; readonly percent: number }

/**
 * Un critère du barème, tel que verrouillé après validation humaine.
 *
 * Toutes les valeurs sont figées : ce type décrit une version verrouillée, jamais
 * un brouillon. Un critère proposé par l'IA et non validé n'arrive jamais ici.
 */
export interface RubricCriterion {
  readonly id: RubricCriterionId
  readonly questionId: QuestionId
  readonly label: string
  readonly attribution: AttributionType
  /** Valeur nominale du critère. */
  readonly pointsMax: Millipoints
  /** Ordre d'évaluation, pour rendre la répartition des restes reproductible. */
  readonly order: number
  /** Si vrai, son absence déclenche `MissingRequiredPolicy` au niveau de la question. */
  readonly required: boolean
  /** Fraction accordée pour un état `partial`. Ignoré hors attribution `partial`. */
  readonly partialRatioPercent: number
  /** Nombre d'éléments attendus. Utilisé par `per_element`. */
  readonly expectedElementCount: number
  /** Points par élément. Si absent, `pointsMax` est réparti entre les éléments attendus. */
  readonly pointsPerElement: Millipoints | null
  /** Plafond du critère. Si absent, `pointsMax` fait office de plafond. */
  readonly cap: Millipoints | null
  readonly contradictionPolicy: ContradictionPolicy
  /** Points retirés en cas d'erreur factuelle. */
  readonly factualErrorPenalty: Millipoints | null
  /**
   * Critères dont l'attribution rend celui-ci inapplicable.
   *
   * Sert aux réponses mutuellement exclusives : si l'étudiant a obtenu le critère
   * « mécanisme complet », le critère « mécanisme partiel » ne doit pas s'ajouter.
   */
  readonly excludedBy: readonly RubricCriterionId[]
}

/** Règles de calcul au niveau d'une question. */
export interface QuestionGradingRules {
  readonly questionId: QuestionId
  readonly pointsMax: Millipoints
  /** Autorise une note négative. Faux par défaut : une question plancher à zéro. */
  readonly allowNegative: boolean
  /** Pas d'arrondi de la note finale. `null` conserve la précision au millième. */
  readonly roundingStep: Millipoints | null
  readonly missingRequiredPolicy: MissingRequiredPolicy
  /**
   * Autorise le total à dépasser `pointsMax` grâce aux bonus.
   * Faux par défaut : le bonus compense, il ne fait pas dépasser le barème.
   */
  readonly allowBonusOverflow: boolean
}

/**
 * Ce que l'analyse a identifié pour un critère.
 *
 * `evidence` n'entre pas dans le calcul, mais le moteur refuse d'attribuer des
 * points sans elle : « aucune note sans preuve » est vérifié ici, pas seulement
 * documenté.
 */
export interface CriterionAssessment {
  readonly criterionId: RubricCriterionId
  readonly status: CriterionStatus
  /**
   * La réponse contredit l'élément attendu.
   *
   * Volontairement indépendant de `status` : un étudiant peut énoncer
   * correctement un élément puis se contredire plus loin. C'est précisément le
   * cas que vise la règle « plafonner le critère à 50 % en cas de contradiction
   * majeure ». Fusionner les deux notions rendrait cette règle inexprimable.
   */
  readonly contradicted: boolean
  /** La réponse contient une erreur factuelle rattachée à ce critère. */
  readonly factuallyWrong: boolean
  /** Nombre d'éléments distincts identifiés. Utilisé par `per_element`. */
  readonly matchedElementCount: number
  /** Valeur fixée par le correcteur. Requis pour l'attribution `manual`. */
  readonly manualPoints: Millipoints | null
  /** Extraits exacts de la réponse justifiant cet état. */
  readonly evidence: readonly string[]
}

/** Trace d'une règle appliquée, pour rendre le calcul explicable. */
export interface AppliedRule {
  /** Code stable, exploitable par le code et les statistiques. */
  readonly rule: string
  /** Explication destinée à un enseignant. */
  readonly detail: string
  readonly before: Millipoints
  readonly after: Millipoints
}

/** Résultat du calcul pour un critère. */
export interface CriterionOutcome {
  readonly criterionId: RubricCriterionId
  readonly label: string
  readonly status: CriterionStatus
  readonly contradicted: boolean
  readonly factuallyWrong: boolean
  readonly pointsPossible: Millipoints
  readonly pointsComputed: Millipoints
  /** Vrai si un autre critère a rendu celui-ci inapplicable. */
  readonly excluded: boolean
  /** Vrai si des points ont été refusés faute d'extrait justificatif. */
  readonly deniedForMissingEvidence: boolean
  readonly appliedRules: readonly AppliedRule[]
}

/** Résultat du calcul pour une question. */
export interface QuestionOutcome {
  readonly questionId: QuestionId
  readonly criteria: readonly CriterionOutcome[]
  /** Somme brute des critères, avant plafonds et arrondi. */
  readonly rawTotal: Millipoints
  /** Après plafonds, planchers et politique des critères obligatoires. */
  readonly cappedTotal: Millipoints
  /** Après arrondi. C'est la valeur proposée au correcteur. */
  readonly total: Millipoints
  readonly pointsMax: Millipoints
  readonly appliedRules: readonly AppliedRule[]
}

/** Erreur de configuration ou d'entrée du moteur. */
export class GradingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GradingError'
  }
}
