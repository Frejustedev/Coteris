/**
 * Métriques d'évaluation du pipeline.
 *
 * Le cahier des charges est explicite sur un point, et il a raison : **ne pas
 * mesurer uniquement le taux de caractères OCR corrects**. Une transcription
 * imparfaite peut donner une note juste, et une transcription parfaite peut
 * donner une note fausse si les critères sont mal identifiés. Ce qui compte est
 * l'accord avec la décision humaine.
 *
 * Toutes les fonctions sont pures. Elles reçoivent des observations, elles
 * rendent des nombres — ce qui permet de les vérifier sur des cas construits à la
 * main, et donc de faire confiance aux chiffres qu'elles produiront un jour sur
 * de vraies copies.
 */

/** Ce que le système a proposé pour un critère, face à ce que l'humain a décidé. */
export interface ObservationCritère {
  readonly criterionId: string
  /** État proposé par l'analyse. */
  readonly proposé: 'present' | 'partial' | 'absent'
  /** État retenu par le correcteur, qui fait référence. */
  readonly référence: 'present' | 'partial' | 'absent'
  /** Points proposés, en millièmes. */
  readonly pointsProposés: number
  /** Points attribués par l'humain, en millièmes. */
  readonly pointsRéférence: number
  readonly niveauConfiance: 'green' | 'orange' | 'red'
}

export interface ObservationRéponse {
  readonly submissionId: string
  readonly questionId: string
  readonly critères: readonly ObservationCritère[]
  /** Total proposé pour la question, en millièmes. */
  readonly totalProposé: number
  /** Total retenu par l'humain, en millièmes. */
  readonly totalRéférence: number
  readonly pointsMax: number
  readonly niveauConfiance: 'green' | 'orange' | 'red'
  readonly aDemandéValidation: boolean
  readonly duréeMs: number
  /** Coût de l'analyse, en millionièmes d'euro. */
  readonly coûtMicroEur: number
  readonly pages: number
}

// --- Accord et détection ----------------------------------------------------------

export interface AccordParCritère {
  readonly total: number
  readonly enAccord: number
  /** Proportion d'états identiques entre proposition et décision humaine. */
  readonly taux: number
}

export function accordParCritère(observations: readonly ObservationCritère[]): AccordParCritère {
  const total = observations.length
  const enAccord = observations.filter((o) => o.proposé === o.référence).length
  return { total, enAccord, taux: total === 0 ? 0 : enAccord / total }
}

export interface DétectionCritères {
  readonly vraisPositifs: number
  readonly fauxPositifs: number
  readonly fauxNégatifs: number
  readonly précision: number
  readonly rappel: number
  readonly f1: number
}

/**
 * Précision et rappel de la détection.
 *
 * « Détecté » signifie ici : le système a jugé le critère présent ou partiel,
 * c'est-à-dire qu'il a accordé au moins une part des points.
 *
 * - **Faux positif** : le système accorde des points que l'humain refuse. C'est
 *   l'erreur la plus grave sur un examen, puisqu'elle avantage indûment.
 * - **Faux négatif** : le système refuse des points que l'humain accorde. Moins
 *   grave, car le correcteur le rattrape à la relecture.
 *
 * Ces deux erreurs n'ont donc pas le même poids, et le rapport doit les
 * présenter séparément plutôt que derrière un score unique.
 */
export function détectionCritères(
  observations: readonly ObservationCritère[],
): DétectionCritères {
  const détecté = (état: ObservationCritère['proposé' | 'référence']) => état !== 'absent'

  let vraisPositifs = 0
  let fauxPositifs = 0
  let fauxNégatifs = 0

  for (const o of observations) {
    const p = détecté(o.proposé)
    const r = détecté(o.référence)
    if (p && r) vraisPositifs += 1
    else if (p && !r) fauxPositifs += 1
    else if (!p && r) fauxNégatifs += 1
  }

  const précision =
    vraisPositifs + fauxPositifs === 0 ? 0 : vraisPositifs / (vraisPositifs + fauxPositifs)
  const rappel =
    vraisPositifs + fauxNégatifs === 0 ? 0 : vraisPositifs / (vraisPositifs + fauxNégatifs)
  const f1 = précision + rappel === 0 ? 0 : (2 * précision * rappel) / (précision + rappel)

  return { vraisPositifs, fauxPositifs, fauxNégatifs, précision, rappel, f1 }
}

// --- Erreur de note ----------------------------------------------------------------

export interface ErreurNote {
  /** Écart absolu moyen, en millièmes de point. */
  readonly erreurAbsolueMoyenne: number
  /** Écart moyen signé : positif si le système est globalement trop généreux. */
  readonly biais: number
  /** Écart absolu maximal observé. */
  readonly erreurMax: number
  /** Part des réponses dont la note proposée est exactement celle retenue. */
  readonly tauxExact: number
  readonly effectif: number
}

export function erreurNote(observations: readonly ObservationRéponse[]): ErreurNote {
  if (observations.length === 0) {
    return { erreurAbsolueMoyenne: 0, biais: 0, erreurMax: 0, tauxExact: 0, effectif: 0 }
  }

  let sommeAbsolue = 0
  let sommeSignée = 0
  let max = 0
  let exacts = 0

  for (const o of observations) {
    const écart = o.totalProposé - o.totalRéférence
    sommeAbsolue += Math.abs(écart)
    sommeSignée += écart
    if (Math.abs(écart) > max) max = Math.abs(écart)
    if (écart === 0) exacts += 1
  }

  return {
    erreurAbsolueMoyenne: sommeAbsolue / observations.length,
    // Le signe est informatif : un système systématiquement trop généreux est un
    // problème différent d'un système imprécis dans les deux sens.
    biais: sommeSignée / observations.length,
    erreurMax: max,
    tauxExact: exacts / observations.length,
    effectif: observations.length,
  }
}

// --- Fiabilité des cas verts ---------------------------------------------------------

export interface FiabilitéVerts {
  readonly effectif: number
  /** Part des cas verts dont la note proposée a été retenue sans modification. */
  readonly tauxSansModification: number
  /** Cas verts que l'humain a corrigés : les plus coûteux en confiance. */
  readonly modifiés: number
  readonly erreurAbsolueMoyenne: number
}

/**
 * Fiabilité des décisions classées vertes.
 *
 * C'est **la** métrique décisive du produit. Un cas vert est celui qu'un
 * enseignant sera tenté de valider sans relire. S'il s'y trouve des erreurs, la
 * promesse de Coteris s'effondre — bien plus sûrement qu'avec un taux de rappel
 * moyen.
 */
export function fiabilitéVerts(observations: readonly ObservationRéponse[]): FiabilitéVerts {
  const verts = observations.filter((o) => o.niveauConfiance === 'green')
  if (verts.length === 0) {
    return { effectif: 0, tauxSansModification: 0, modifiés: 0, erreurAbsolueMoyenne: 0 }
  }

  const modifiés = verts.filter((o) => o.totalProposé !== o.totalRéférence).length
  const sommeÉcarts = verts.reduce((s, o) => s + Math.abs(o.totalProposé - o.totalRéférence), 0)

  return {
    effectif: verts.length,
    tauxSansModification: (verts.length - modifiés) / verts.length,
    modifiés,
    erreurAbsolueMoyenne: sommeÉcarts / verts.length,
  }
}

// --- Recours à l'humain, coûts, durées -------------------------------------------------

export interface RépartitionConfiance {
  readonly vert: number
  readonly orange: number
  readonly rouge: number
  readonly tauxValidationRequise: number
}

export function répartitionConfiance(
  observations: readonly ObservationRéponse[],
): RépartitionConfiance {
  const vert = observations.filter((o) => o.niveauConfiance === 'green').length
  const orange = observations.filter((o) => o.niveauConfiance === 'orange').length
  const rouge = observations.filter((o) => o.niveauConfiance === 'red').length
  const requises = observations.filter((o) => o.aDemandéValidation).length

  return {
    vert,
    orange,
    rouge,
    tauxValidationRequise: observations.length === 0 ? 0 : requises / observations.length,
  }
}

export interface Coûts {
  /** En millionièmes d'euro. */
  readonly total: number
  readonly parRéponse: number
  readonly parPage: number
  readonly parCopie: number
  readonly duréeMoyenneMs: number
}

export function coûts(observations: readonly ObservationRéponse[]): Coûts {
  if (observations.length === 0) {
    return { total: 0, parRéponse: 0, parPage: 0, parCopie: 0, duréeMoyenneMs: 0 }
  }

  const total = observations.reduce((s, o) => s + o.coûtMicroEur, 0)
  const pages = observations.reduce((s, o) => s + o.pages, 0)
  const copies = new Set(observations.map((o) => o.submissionId)).size
  const durée = observations.reduce((s, o) => s + o.duréeMs, 0)

  return {
    total,
    parRéponse: total / observations.length,
    parPage: pages === 0 ? 0 : total / pages,
    parCopie: copies === 0 ? 0 : total / copies,
    duréeMoyenneMs: durée / observations.length,
  }
}

// --- Rapport complet ---------------------------------------------------------------

/**
 * Ce que le rapport mesure réellement.
 *
 * `chaine_complete` : lecture manuscrite **et** analyse. Le seul résultat qui
 * réponde à la question du produit.
 *
 * `borne_haute` : analyse seule, sur des transcriptions parfaites — des réponses
 * saisies, par exemple. Si le système échoue ici, aucun OCR ne le sauvera ; s'il
 * réussit, on ne sait toujours pas ce que la lecture manuscrite fera perdre.
 *
 * `mixte` : le jeu mélange les deux origines. Les chiffres agrégés ne sont alors
 * interprétables ni comme l'un ni comme l'autre.
 */
export type PortéeMesure = 'chaine_complete' | 'borne_haute' | 'mixte'

export const PORTÉE_LABELS: Record<PortéeMesure, string> = {
  chaine_complete: 'chaîne complète (lecture manuscrite + analyse)',
  // « fidèles » et non « parfaites » : la source est saisie, donc sans
  // incertitude de lecture, mais l'extraction reste un traitement faillible. Un
  // audit a montré 137 transcriptions sur 208 infidèles alors que le rapport les
  // annonçait parfaites — l'étiquette avait rendu ce défaut impensable.
  borne_haute: 'BORNE HAUTE — analyse seule, sur transcriptions fidèles (réponses saisies)',
  mixte: 'MIXTE — le jeu mélange manuscrit et saisie, chiffres non interprétables',
}

/**
 * Finesse de la décision humaine à laquelle on se compare.
 *
 * `critère` : le correcteur s'est prononcé critère par critère. Précision et
 * rappel de détection sont alors interprétables.
 *
 * `question` : le correcteur a mis une note globale. On compare donc des totaux.
 * Précision et rappel restent calculables, mais à la granularité de la
 * question — « le système a-t-il accordé des points là où l'humain en a
 * accordé ? » — et non du critère. C'est plus grossier, et il faut le dire.
 */
export type Granularité = 'critère' | 'question'

export const GRANULARITÉ_LABELS: Record<Granularité, string> = {
  critère: 'par critère',
  question: 'par question (le correcteur n’a pas détaillé)',
}

export interface RapportPipeline {
  readonly pipeline: string
  /** Ce que ces chiffres mesurent réellement. */
  readonly portée: PortéeMesure
  /** À quelle finesse la comparaison est faite. */
  readonly granularité: Granularité
  readonly effectifRéponses: number
  readonly effectifCritères: number
  readonly accord: AccordParCritère
  readonly détection: DétectionCritères
  readonly note: ErreurNote
  readonly verts: FiabilitéVerts
  readonly confiance: RépartitionConfiance
  readonly coûts: Coûts
}

/**
 * Détermine ce qu'un jeu permet réellement de mesurer.
 *
 * Un jeu mélangeant manuscrit et saisie ne mesure ni l'un ni l'autre : les
 * chiffres agrégés y seraient une moyenne entre deux choses différentes.
 */
export function portéeDuJeu(
  origines: readonly ('manuscrit' | 'saisie')[],
): PortéeMesure {
  if (origines.length === 0) return 'mixte'
  const manuscrit = origines.some((o) => o === 'manuscrit')
  const saisie = origines.some((o) => o === 'saisie')
  if (manuscrit && saisie) return 'mixte'
  return manuscrit ? 'chaine_complete' : 'borne_haute'
}

export function évaluer(
  pipeline: string,
  observations: readonly ObservationRéponse[],
  portée: PortéeMesure = 'chaine_complete',
  granularité: Granularité = 'critère',
): RapportPipeline {
  const critères = observations.flatMap((o) => o.critères)

  return {
    pipeline,
    portée,
    granularité,
    effectifRéponses: observations.length,
    effectifCritères: critères.length,
    accord: accordParCritère(critères),
    détection: détectionCritères(critères),
    note: erreurNote(observations),
    verts: fiabilitéVerts(observations),
    confiance: répartitionConfiance(observations),
    coûts: coûts(observations),
  }
}

/**
 * Effectif minimal en dessous duquel un chiffre ne veut rien dire.
 *
 * Annoncer « 94 % d'accord » sur douze réponses serait trompeur. Le rapport
 * affiche l'effectif à côté de chaque taux, et refuse de conclure en deçà de ce
 * seuil.
 */
export const EFFECTIF_MINIMAL_SIGNIFICATIF = 200

export function estSignificatif(rapport: RapportPipeline): boolean {
  return rapport.effectifCritères >= EFFECTIF_MINIMAL_SIGNIFICATIF
}

/**
 * Un rapport peut-il servir à choisir un fournisseur d'OCR ?
 *
 * Non si les transcriptions étaient parfaites : le rapport ne dit alors rien de
 * la lecture manuscrite. C'est la confusion que ce garde-fou empêche.
 */
export function permetDeChoisirUnOcr(rapport: RapportPipeline): boolean {
  return rapport.portée === 'chaine_complete' && estSignificatif(rapport)
}
