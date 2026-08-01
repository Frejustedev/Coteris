/**
 * Recalage des extraits cités par le modèle sur le texte réel de la copie.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * `validateEvidence` (../analysis.ts) exige que chaque extrait figure
 * **littéralement** dans la transcription. Sa tolérance est étroite : casse,
 * espaces, apostrophes et guillemets courbes — et rien d'autre. En particulier,
 * **elle ne tolère pas les accents**.
 *
 * Un modèle de langage restitue régulièrement « proteger la thyroide » là où la
 * copie porte « protéger la thyroïde ». Il ne ment pas, il normalise. Mais sans
 * recalage, cette différence fait rejeter l'analyse entière — et un rejet, dans
 * ce pipeline, devient un zéro enregistré, pas une erreur visible.
 *
 * Le simulateur ne rencontre jamais ce problème parce qu'il découpe ses extraits
 * dans le texte original ; il n'écrit jamais de texte lui-même. Un fournisseur
 * réel, si.
 *
 * LA RÈGLE
 *
 * On cherche avec une normalisation **permissive** (accents retirés) et on
 * retourne toujours la sous-chaîne **originale** de la copie. La preuve archivée
 * cite donc la copie, jamais la reformulation du modèle. C'est aussi ce qui sera
 * montré à l'enseignant : il doit y reconnaître l'écriture de son étudiant.
 */

/** Texte replié pour la recherche, avec la table des positions d'origine. */
interface Replie {
  readonly replie: string
  /** Pour chaque position du texte replié, la position dans le texte original. */
  readonly positions: readonly number[]
}

/**
 * Replie un texte pour la recherche, en conservant la correspondance des positions.
 *
 * Le piège : `normalize('NFD')` décompose « é » en deux caractères. Retirer les
 * diacritiques change alors la longueur de la chaîne, et un index calculé sur le
 * texte replié ne désigne plus le bon caractère dans l'original — l'extrait
 * retourné serait décalé de quelques caractères, silencieusement.
 *
 * On construit donc la table `positions` en parallèle du repliage. Chaque
 * position pointe vers un caractère **entier** du texte original : les découpes
 * ne tombent jamais au milieu d'un caractère composé.
 */
function replier(texte: string): Replie {
  let replie = ''
  const positions: number[] = []
  let espacePrecedent = false

  for (let i = 0; i < texte.length; i++) {
    const caractere = texte[i] as string

    if (/\s/u.test(caractere)) {
      // Une suite d'espaces, de tabulations ou de sauts de ligne devient un
      // espace unique : le modèle reformate volontiers les retours à la ligne.
      if (!espacePrecedent && replie.length > 0) {
        replie += ' '
        positions.push(i)
      }
      espacePrecedent = true
      continue
    }

    espacePrecedent = false
    const plie = caractere
      .normalize('NFD')
      .replace(/[̀-ͯ]/gu, '')
      .replace(/[‘’ʼ]/gu, "'")
      .replace(/[“”]/gu, '"')
      .toLocaleLowerCase('fr-FR')

    for (const c of plie) {
      replie += c
      positions.push(i)
    }
  }

  // Un espace final ne doit pas empêcher une correspondance.
  if (replie.endsWith(' ')) {
    return { replie: replie.slice(0, -1), positions: positions.slice(0, -1) }
  }

  return { replie, positions }
}

/**
 * Retrouve dans la transcription la sous-chaîne littérale correspondant à
 * l'extrait cité par le modèle.
 *
 * @returns Le texte **tel qu'il figure dans la copie**, ou `null` si l'extrait
 *   ne s'y retrouve pas même en recherche permissive. Un `null` signifie que la
 *   citation est fabriquée : elle ne doit jamais justifier de points.
 */
export function recalerExtrait(transcription: string, extrait: string): string | null {
  const foin = replier(transcription)
  const aiguille = replier(extrait)

  if (aiguille.replie.length === 0) return null

  const index = foin.replie.indexOf(aiguille.replie)
  if (index === -1) return null

  const debut = foin.positions[index]
  const finIncluse = foin.positions[index + aiguille.replie.length - 1]
  if (debut === undefined || finIncluse === undefined) return null

  return transcription.slice(debut, finIncluse + 1).trim()
}

/**
 * Tronque une chaîne à une longueur maximale, sur une frontière de mot.
 *
 * Les bornes de longueur du schéma zod (`explanation` ≤ 500, `reason` ≤ 300) ne
 * sont **pas** transmises au modèle : les sorties structurées ne supportent ni
 * `maxLength` ni les contraintes numériques, les SDK les retirent du schéma
 * envoyé. Une explication de 520 caractères — comportement parfaitement naturel
 * d'un modèle en français soigné — invaliderait donc toute l'analyse.
 *
 * On tronque plutôt que de rejeter : perdre la fin d'une explication est sans
 * commune mesure avec perdre la correction d'une question entière.
 */
export function tronquer(texte: string, maximum: number): string {
  if (texte.length <= maximum) return texte

  const coupe = texte.slice(0, maximum)
  const dernierEspace = coupe.lastIndexOf(' ')

  // On ne recule jusqu'au dernier espace que s'il reste l'essentiel du texte ;
  // sinon on coupe net plutôt que de rendre une explication amputée de moitié.
  const retenu = dernierEspace > maximum * 0.8 ? coupe.slice(0, dernierEspace) : coupe
  return retenu.trimEnd()
}
