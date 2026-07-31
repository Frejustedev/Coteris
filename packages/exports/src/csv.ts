/**
 * Génération de fichiers CSV.
 *
 * Fonctions pures : elles reçoivent des données, elles rendent une chaîne. Aucune
 * base, aucun fichier — donc testables exhaustivement.
 *
 * Deux particularités méritent d'être expliquées, parce qu'elles ne sont pas
 * évidentes et qu'on les découvre en général en production.
 *
 * ## 1. Le CSV « français »
 *
 * Excel en configuration française attend le **point-virgule** comme séparateur
 * et la **virgule** comme séparateur décimal. Un fichier séparé par des virgules
 * s'ouvre dans une seule colonne, et l'utilisateur conclut que l'export est cassé.
 *
 * La marque d'ordre des octets (BOM) en tête est également nécessaire : sans elle,
 * Excel lit le fichier dans l'encodage local et les accents deviennent illisibles.
 *
 * ## 2. L'injection de formule
 *
 * Une cellule commençant par `=`, `+`, `-` ou `@` est interprétée comme une
 * formule à l'ouverture. Une valeur comme `=HYPERLINK("http://x","cliquez")`,
 * venue par exemple d'un nom d'étudiant importé, s'exécute sur le poste de
 * l'enseignant. C'est une vulnérabilité connue et régulièrement oubliée.
 *
 * On préfixe donc ces valeurs d'une apostrophe, qui force Excel à les traiter
 * comme du texte sans altérer ce que l'utilisateur lit.
 */

export interface CsvOptions {
  /** Séparateur de colonnes. Point-virgule par défaut, pour Excel francophone. */
  readonly delimiter?: string
  /** Ajoute la marque d'ordre des octets. Vrai par défaut. */
  readonly bom?: boolean
  /** Fin de ligne. CRLF par défaut, comme l'attend Excel. */
  readonly eol?: string
}

const CARACTÈRES_DE_FORMULE = ['=', '+', '-', '@', '\t', '\r']

/**
 * Échappe une valeur pour le CSV.
 *
 * Neutralise d'abord l'injection de formule, puis applique les guillemets si la
 * valeur contient un séparateur, un guillemet ou un saut de ligne.
 */
export function escapeCsvValue(valeur: unknown, delimiter: string): string {
  if (valeur === null || valeur === undefined) return ''

  let texte = String(valeur)

  if (texte.length > 0 && CARACTÈRES_DE_FORMULE.includes(texte[0] as string)) {
    texte = `'${texte}`
  }

  const doitÊtreCité =
    texte.includes(delimiter) ||
    texte.includes('"') ||
    texte.includes('\n') ||
    texte.includes('\r')

  return doitÊtreCité ? `"${texte.replace(/"/g, '""')}"` : texte
}

/** Assemble un tableau de lignes en CSV. */
export function toCsv(
  entêtes: readonly string[],
  lignes: readonly (readonly unknown[])[],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ';'
  const eol = options.eol ?? '\r\n'
  const bom = options.bom ?? true

  const contenu = [entêtes, ...lignes]
    .map((ligne) => ligne.map((cellule) => escapeCsvValue(cellule, delimiter)).join(delimiter))
    .join(eol)

  return `${bom ? '﻿' : ''}${contenu}${eol}`
}

/**
 * Formate des points en millièmes pour un tableur francophone.
 *
 * Virgule décimale, et aucune décimale inutile : `0,25` plutôt que `0,250`.
 */
export function formatPointsCsv(millipoints: number | null): string {
  if (millipoints === null) return ''
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(millipoints / 1000)
}

/** Formate un horodatage de façon lisible et triable. */
export function formatDateCsv(date: Date | null): string {
  if (!date) return ''
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return (
    `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`
  )
}
