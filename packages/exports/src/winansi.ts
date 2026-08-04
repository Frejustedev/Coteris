/**
 * Assainissement des textes pour les polices PDF standard.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Les polices standard d'un PDF (Helvetica et consorts) encodent en WinAnsi,
 * c'est-à-dire CP1252 : 224 caractères, tout l'alphabet latin accentué, et rien
 * d'autre. `pdf-lib` ne remplace pas silencieusement ce qu'elle ne sait pas
 * écrire — elle **lève**.
 *
 * Le mode d'échec est donc particulièrement traître : le code compile, le lint
 * passe, et les tests sur des fixtures françaises passent aussi. La génération
 * casse à la première copie contenant α, →, ≥ ou un emoji — c'est-à-dire chez
 * l'utilisateur, sur une copie de sciences.
 *
 * CE QUI EST SUBSTITUÉ, ET POURQUOI ON LE DIT
 *
 * Un extrait de copie est une **citation littérale** de ce que l'étudiant a
 * écrit. Remplacer un caractère en silence altère cette citation. On substitue
 * donc — l'alternative, embarquer une police Unicode complète, alourdirait
 * chaque document de plusieurs centaines de kilo-octets — mais on **compte** les
 * substitutions, pour que le document puisse le signaler à son lecteur.
 */

/** Caractères de CP1252 situés entre 0x80 et 0x9F, absents de Latin-1. */
const CP1252_HAUT = new Set(
  [
    '€', '‚', 'ƒ', '„', '…', '†', '‡',
    'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '‘',
    '’', '“', '”', '•', '–', '—', '˜',
    '™', 'š', '›', 'œ', 'ž', 'Ÿ',
  ].map((c) => c.codePointAt(0) as number),
)

function encodable(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true
  return CP1252_HAUT.has(codePoint)
}

/**
 * Équivalents lisibles pour les caractères courants hors CP1252.
 *
 * Chacun est une perte assumée, mais une perte qui garde le sens : « ≥ » rendu
 * « >= » reste compréhensible, rendu « ? » ne l'est plus. La liste couvre ce
 * qu'on rencontre réellement dans des copies de sciences et de santé.
 */
const ÉQUIVALENTS: ReadonlyMap<string, string> = new Map([
  ['→', '->'], ['←', '<-'], ['↔', '<->'], ['⇒', '=>'], ['⇔', '<=>'],
  ['≥', '>='], ['≤', '<='], ['≠', '!='], ['≈', '~'], ['≡', '='],
  ['∞', 'infini'], ['√', 'racine de '], ['∑', 'somme'], ['∏', 'produit'],
  ['∆', 'delta'], ['∂', 'd'], ['∫', 'integrale'], ['±', '+/-'],
  ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'],
  ['ε', 'epsilon'], ['θ', 'theta'], ['λ', 'lambda'], ['μ', 'micro'],
  ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'],
  ['ω', 'omega'], ['Ω', 'ohm'], ['Δ', 'delta'], ['Σ', 'somme'],
  ['−', '-'], ['⁄', '/'], ['→', '->'],
  [' ', ' '], [' ', ' '], [' ', ' '], ['​', ''],
  ['‑', '-'], ['―', '-'],
])

export interface TexteAssaini {
  readonly texte: string
  /** Nombre de caractères qui n'ont pas pu être rendus tels quels. */
  readonly substitutions: number
}

/**
 * Rend un texte écrivable par une police PDF standard.
 *
 * Les caractères sans équivalent deviennent « ? » — visible, jamais silencieux,
 * et compté.
 */
export function assainirPourWinAnsi(texte: string): TexteAssaini {
  let résultat = ''
  let substitutions = 0

  // NFC recompose « e + accent aigu » en « é », qui est encodable, là où la
  // forme décomposée ne l'est pas. Sans cette normalisation, un texte
  // parfaitement français échouerait selon la manière dont il a été saisi.
  for (const caractère of texte.normalize('NFC')) {
    const point = caractère.codePointAt(0)
    if (point === undefined) continue

    if (encodable(point)) {
      résultat += caractère
      continue
    }

    const équivalent = ÉQUIVALENTS.get(caractère)
    if (équivalent !== undefined) {
      résultat += équivalent
      substitutions += 1
      continue
    }

    // Les marques combinantes survivantes après NFC — un accent posé sur une
    // lettre qui ne forme pas de caractère précomposé — sont retirées plutôt que
    // remplacées : « ? » au milieu d'un mot le rendrait illisible.
    if (point >= 0x0300 && point <= 0x036f) {
      substitutions += 1
      continue
    }

    résultat += '?'
    substitutions += 1
  }

  return { texte: résultat, substitutions }
}
