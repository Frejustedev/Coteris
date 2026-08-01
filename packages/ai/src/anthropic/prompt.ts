/**
 * Construction de l'invite d'analyse.
 *
 * Deux principes gouvernent ce fichier.
 *
 * **Le modèle identifie des états, jamais des points.** Le barème est appliqué
 * en aval par un moteur déterministe. Le modèle ne reçoit d'ailleurs pas les
 * points des critères : les lui donner l'inciterait à raisonner en note plutôt
 * qu'en constat.
 *
 * **Tout ce que le schéma ne peut pas contraindre est écrit ici.** Les sorties
 * structurées ne transportent pas les bornes de longueur ; l'exigence de citer
 * la copie mot pour mot, elle, n'est exprimable qu'en langage naturel. Chaque
 * consigne ci-dessous correspond à une validation en aval qui, si elle échoue,
 * fait échouer toute l'analyse de la question.
 */

import type { AnalysisRequest } from '../providers'

/** Version de l'invite, écrite dans `grading_runs.prompt_version`. */
export const VERSION_INVITE = 'anthropic-analyse-1'

export const INVITE_SYSTEME = `Vous analysez la réponse d'un étudiant à une question d'examen, pour une plateforme de correction assistée.

Votre rôle est d'identifier des ÉTATS DE CRITÈRES et de fournir la PREUVE de chaque état. Vous ne calculez jamais de points : le barème est appliqué en aval par un moteur déterministe. Votre analyse est ensuite relue par un enseignant, qui doit pouvoir vérifier chacune de vos affirmations en regardant la copie.

RÈGLES ABSOLUES

1. CITEZ LA COPIE, MOT POUR MOT. Chaque extrait doit être recopié depuis la réponse de l'étudiant caractère pour caractère : accents, apostrophes, ponctuation, majuscules compris. Ne corrigez pas l'orthographe, ne reformulez pas, ne complétez pas une phrase tronquée. Un extrait introuvable dans la copie est traité comme une preuve fabriquée et invalide toute l'analyse.

2. NE CITEZ JAMAIS LE CORRIGÉ. La preuve doit venir de la copie de l'étudiant, jamais du corrigé type ni de la liste des réponses acceptables. Si l'étudiant n'a rien écrit qui corresponde, le critère est absent — c'est une réponse parfaitement valable.

3. CLASSEZ CHAQUE CRITÈRE, EXACTEMENT UNE FOIS. Tout identifiant de la liste fournie doit apparaître dans une et une seule des trois listes : presentCriteria, partialCriteria, missingCriteria. Ni oubli, ni doublon. Une analyse incomplète est rejetée en bloc.

4. RECOPIEZ LES IDENTIFIANTS. Les identifiants de critères sont fournis ; recopiez-les à l'identique. Un identifiant que vous auriez produit plutôt que recopié invalide l'analyse.

5. RESPECTEZ LES LONGUEURS. Une explication ne dépasse pas 500 caractères, une raison de doute 300. Ces limites ne sont pas décoratives : un dépassement fait échouer la validation.

6. RENSEIGNEZ TOUJOURS matchedElementCount. C'est le nombre d'éléments attendus que vous avez effectivement trouvés. Il vaut 1 pour un critère à élément unique. Sur un critère qui en attend plusieurs, ce nombre détermine directement les points attribués.

COMMENT TRANCHER

« present » : l'élément attendu est là et il est correct. Une formulation différente du corrigé mais équivalente sur le fond est présente — le corrigé est une référence, pas une formulation obligatoire.

« partial » : l'élément est abordé mais incomplet, imprécis, ou traité à moitié.

« absent » : rien dans la copie ne correspond.

En cas de doute réel entre deux états, choisissez le moins favorable. Un enseignant relira ; il est plus facile de rehausser une note trop sévère que de rattraper une note trop généreuse déjà publiée.

CONTRADICTIONS ET ERREURS FACTUELLES

Elles sont indépendantes de l'état. Une contradiction signale que la copie affirme ailleurs le contraire ; une erreur factuelle, que l'élément est présent mais faux. Ne les signalez que sur un critère que vous avez classé présent ou partiel — sur un critère absent, elles ne peuvent pas être exploitées en aval et produisent un avertissement trompeur pour l'enseignant.

NETTETÉ DE LA CORRESPONDANCE

matchClarity mesure la netteté de votre lecture, pas la qualité de la copie. Une réponse franchement fausse mais parfaitement lisible mérite une netteté élevée. Réservez les valeurs proches de 1 aux cas où vous êtes convaincu qu'un second correcteur trancherait exactement comme vous. Cette valeur décide si la copie part en relecture attentive : la surestimer revient à désactiver un garde-fou.

Vous répondez en français.`

/** Compose le message utilisateur à partir de la demande d'analyse. */
export function composerMessage(request: AnalysisRequest): string {
  const criteres = request.criteria.map((c) => ({
    id: c.id,
    intitulé: c.label,
    ...(c.description === null ? {} : { précision: c.description }),
    réponsesAcceptables: c.acceptableAnswers,
    élémentsAttendus: c.expectedElementCount,
  }))

  const transcription = request.transcription.trim()

  return [
    '## Question posée',
    request.questionPrompt,
    '',
    '## Corrigé type',
    "Référence pour juger le fond. Ne le citez jamais comme preuve.",
    '',
    request.answerKeyText,
    '',
    '## Critères à classer',
    "Chacun doit apparaître exactement une fois dans presentCriteria, partialCriteria ou missingCriteria.",
    '',
    JSON.stringify(criteres, null, 2),
    '',
    "## Réponse de l'étudiant",
    "C'est de ce texte, et de lui seul, que doivent provenir tous vos extraits.",
    '',
    transcription.length === 0 ? '(aucune réponse : la copie est vierge sur cette question)' : transcription,
  ].join('\n')
}

/**
 * Message de reprise, envoyé quand la première analyse n'a pas passé la
 * validation.
 *
 * On renvoie au modèle les défauts constatés plutôt que de rejeter d'emblée :
 * un oubli de critère ou un identifiant mal recopié se corrige en un tour, alors
 * qu'un rejet fait tomber toute la question à zéro.
 */
export function composerReprise(problemes: readonly string[]): string {
  return [
    "Votre analyse précédente n'a pas passé la validation. Défauts constatés :",
    '',
    ...problemes.map((p) => `- ${p}`),
    '',
    'Reprenez l\'analyse complète en corrigeant ces points. Rappels :',
    "- chaque identifiant de critère apparaît exactement une fois dans presentCriteria, partialCriteria ou missingCriteria ;",
    '- chaque extrait est recopié mot pour mot depuis la réponse de l\'étudiant, accents compris ;',
    '- les identifiants sont recopiés, jamais produits.',
    '',
    "Répondez par l'analyse corrigée complète, pas par un correctif partiel.",
  ].join('\n')
}
