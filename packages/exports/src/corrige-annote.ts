/**
 * Corrigé annoté remis à l'étudiant.
 *
 * C'est le document où la promesse du produit devient vérifiable par celui
 * qu'elle concerne : en regard de chaque critère, l'extrait de SA copie qui a
 * justifié les points. Un étudiant qui conteste n'a pas à croire sur parole ; il
 * lit ce qui a été retenu de sa réponse.
 *
 * CE QUE CE DOCUMENT NE CONTIENT PAS, ET POURQUOI
 *
 * **Aucun motif de correcteur.** Le champ qui ressemble le plus à un
 * « commentaire » est le motif d'écart à la proposition du modèle, exigé pour
 * défendre une note devant un jury. Ce n'est pas un message pédagogique, et le
 * publier exposerait une délibération interne.
 *
 * **Aucun raisonnement du modèle, aucun score de confiance, aucun identifiant
 * technique.** L'étudiant reçoit ce qui fonde sa note, pas la mécanique qui l'a
 * produite.
 *
 * **Aucune image de la copie.** Les positions des extraits ne sont pas
 * enregistrées, donc rien ne pourrait être surligné ; et la clé d'image
 * disponible désigne la page entière, la même pour toutes les questions — le
 * document contiendrait N fois la copie complète pour aucun gain. Ce corrigé est
 * textuel, et le dit.
 *
 * **Aucune note d'un autre étudiant.** Le document porte sur une copie.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import { assainirPourWinAnsi } from './winansi'

/** Points en millièmes, comme partout dans le dépôt. */
type Millipoints = number

export interface CritèreCorrigé {
  readonly intitulé: string
  readonly pointsObtenus: Millipoints
  readonly pointsPossibles: Millipoints
  /** Extraits littéraux de la copie ayant justifié l'état du critère. */
  readonly extraits: readonly string[]
  /** Le critère a été reconnu mais laissé à zéro faute d'extrait vérifiable. */
  readonly refuséFauteDePreuve: boolean
  readonly exclu: boolean
}

export interface QuestionCorrigée {
  readonly numéro: string
  readonly énoncé: string
  readonly pointsObtenus: Millipoints
  readonly pointsMax: Millipoints
  readonly critères: readonly CritèreCorrigé[]
}

export interface CorrigéAnnoté {
  readonly titreÉpreuve: string
  /**
   * Code de la copie.
   *
   * Jamais un nom : le document est produit à partir de données pseudonymisées,
   * et l'identité ne se lève que par une action tracée, ailleurs.
   */
  readonly codeCopie: string
  readonly datePublication: Date
  readonly total: Millipoints
  readonly totalMax: Millipoints
  readonly questions: readonly QuestionCorrigée[]
}

// --- Mise en page ------------------------------------------------------------

const A4 = { largeur: 595.28, hauteur: 841.89 }
const MARGE = 56
const LARGEUR_UTILE = A4.largeur - MARGE * 2

const ENCRE = rgb(0.16, 0.17, 0.19)
const ATTÉNUÉ = rgb(0.45, 0.47, 0.5)
const TRAIT = rgb(0.85, 0.86, 0.88)

/** Points en millièmes vers un affichage français : 1500 → « 1,5 ». */
function points(valeur: Millipoints): string {
  return (valeur / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
}

/**
 * Découpe un texte en lignes tenant dans une largeur donnée.
 *
 * Un mot plus long que la largeur — une référence collée, une URL — est coupé
 * de force plutôt que de déborder de la page.
 */
function découper(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
  const lignes: string[] = []

  for (const paragraphe of texte.split('\n')) {
    let courante = ''
    for (const mot of paragraphe.split(/\s+/).filter((m) => m.length > 0)) {
      const essai = courante === '' ? mot : `${courante} ${mot}`
      if (police.widthOfTextAtSize(essai, taille) <= largeur) {
        courante = essai
        continue
      }
      if (courante !== '') lignes.push(courante)

      if (police.widthOfTextAtSize(mot, taille) <= largeur) {
        courante = mot
        continue
      }
      let morceau = ''
      for (const caractère of mot) {
        if (police.widthOfTextAtSize(morceau + caractère, taille) > largeur) {
          lignes.push(morceau)
          morceau = caractère
        } else {
          morceau += caractère
        }
      }
      courante = morceau
    }
    lignes.push(courante)
  }

  return lignes
}

/** Curseur de rendu : page courante et ordonnée. */
interface Curseur {
  page: PDFPage
  y: number
}

export interface RésultatCorrigé {
  readonly pdf: Uint8Array
  /** Caractères de la copie qui n'ont pas pu être rendus tels quels. */
  readonly substitutions: number
}

/**
 * Construit le corrigé annoté.
 *
 * Fonction pure : aucune lecture de base, aucun accès réseau. L'appelant fournit
 * des données déjà vérifiées — en particulier, il lui revient de garantir que
 * toutes les décisions de la copie ont été validées par un humain.
 */
export async function construireCorrigéAnnoté(données: CorrigéAnnoté): Promise<RésultatCorrigé> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Corrigé annoté — ${données.codeCopie}`)
  doc.setCreator('Coteris')
  doc.setProducer('Coteris')

  const normale = await doc.embedFont(StandardFonts.Helvetica)
  const grasse = await doc.embedFont(StandardFonts.HelveticaBold)
  const italique = await doc.embedFont(StandardFonts.HelveticaOblique)

  let substitutions = 0
  /** Assainit et comptabilise en une fois. */
  const propre = (texte: string): string => {
    const assaini = assainirPourWinAnsi(texte)
    substitutions += assaini.substitutions
    return assaini.texte
  }

  const curseur: Curseur = { page: doc.addPage([A4.largeur, A4.hauteur]), y: A4.hauteur - MARGE }

  const nouvellePage = (): void => {
    curseur.page = doc.addPage([A4.largeur, A4.hauteur])
    curseur.y = A4.hauteur - MARGE
  }

  const placer = (hauteur: number): void => {
    if (curseur.y - hauteur < MARGE) nouvellePage()
  }

  const écrire = (
    texte: string,
    options: {
      police?: PDFFont
      taille?: number
      couleur?: typeof ENCRE
      indentation?: number
      espaceAprès?: number
    } = {},
  ): void => {
    const police = options.police ?? normale
    const taille = options.taille ?? 10
    const indentation = options.indentation ?? 0
    const interligne = taille * 1.35

    for (const ligne of découper(propre(texte), police, taille, LARGEUR_UTILE - indentation)) {
      placer(interligne)
      curseur.page.drawText(ligne, {
        x: MARGE + indentation,
        y: curseur.y - taille,
        size: taille,
        font: police,
        color: options.couleur ?? ENCRE,
      })
      curseur.y -= interligne
    }
    curseur.y -= options.espaceAprès ?? 0
  }

  const filet = (): void => {
    placer(12)
    curseur.page.drawLine({
      start: { x: MARGE, y: curseur.y - 4 },
      end: { x: A4.largeur - MARGE, y: curseur.y - 4 },
      thickness: 0.5,
      color: TRAIT,
    })
    curseur.y -= 12
  }

  // --- En-tête ---------------------------------------------------------------
  écrire(données.titreÉpreuve, { police: grasse, taille: 16, espaceAprès: 4 })
  écrire(`Copie ${données.codeCopie}`, { taille: 11, couleur: ATTÉNUÉ })
  écrire(
    `Publié le ${données.datePublication.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`,
    { taille: 9, couleur: ATTÉNUÉ, espaceAprès: 10 },
  )

  écrire(`Note : ${points(données.total)} / ${points(données.totalMax)}`, {
    police: grasse,
    taille: 14,
    espaceAprès: 6,
  })

  écrire(
    "Pour chaque critère du barème, ce document reproduit l'extrait de votre copie qui a " +
      "justifié la décision. Aucun point n'est attribué sans un extrait vérifiable.",
    { taille: 9, couleur: ATTÉNUÉ, espaceAprès: 6 },
  )
  filet()

  // --- Questions -------------------------------------------------------------
  for (const question of données.questions) {
    // Une question ne doit pas commencer en bas de page pour continuer ailleurs :
    // on réserve de quoi porter au moins son titre et une ligne.
    placer(64)

    écrire(
      `Question ${question.numéro} — ${points(question.pointsObtenus)} / ${points(question.pointsMax)}`,
      { police: grasse, taille: 12, espaceAprès: 2 },
    )
    écrire(question.énoncé, { taille: 9, couleur: ATTÉNUÉ, espaceAprès: 6 })

    for (const critère of question.critères) {
      const état = critère.exclu
        ? 'non retenu'
        : `${points(critère.pointsObtenus)} / ${points(critère.pointsPossibles)}`

      écrire(`${critère.intitulé} — ${état}`, { police: grasse, taille: 10, indentation: 12 })

      if (critère.extraits.length > 0) {
        for (const extrait of critère.extraits) {
          écrire(`« ${extrait} »`, {
            police: italique,
            taille: 9,
            indentation: 24,
            couleur: ATTÉNUÉ,
          })
        }
      } else if (critère.refuséFauteDePreuve) {
        écrire(
          "Aucun extrait de votre copie n'a pu justifier ce critère : il est resté à zéro.",
          { taille: 9, indentation: 24, couleur: ATTÉNUÉ },
        )
      } else if (!critère.exclu) {
        écrire('Cet élément ne figure pas dans votre réponse.', {
          taille: 9,
          indentation: 24,
          couleur: ATTÉNUÉ,
        })
      }

      curseur.y -= 4
    }

    curseur.y -= 8
  }

  // --- Pied -----------------------------------------------------------------
  if (substitutions > 0) {
    filet()
    écrire(
      `${substitutions} caractère(s) de votre copie n'ont pas pu être reproduits dans ce ` +
        `format et ont été remplacés. Le texte d'origine reste consultable auprès de votre ` +
        `établissement.`,
      { taille: 8, couleur: ATTÉNUÉ },
    )
  }

  return { pdf: await doc.save(), substitutions }
}
