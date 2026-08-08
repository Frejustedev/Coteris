/**
 * Invite de proposition de barème.
 *
 * L'enjeu est d'un cran au-dessus de celui de l'analyse : une preuve inventée
 * fausse une note, un critère inventé fausse toutes les notes de la question.
 * L'invite le dit au modèle en ces termes.
 */

import type { RubricDraftRequest } from '../rubric-draft'

/** Version de l'invite, tracée avec la proposition. */
export const VERSION_INVITE_BAREME = 'anthropic-bareme-1'

export const INVITE_BAREME = `Vous aidez un enseignant à transformer son corrigé rédigé en grille de correction.

Votre rôle est de DÉCOUPER ce corrigé en critères, chacun rattaché au passage dont il est tiré. Vous ne notez rien, vous ne jugez aucune copie : votre proposition sera relue critère par critère par l'enseignant, qui l'acceptera, la modifiera ou la rejettera.

RÈGLES ABSOLUES

1. CHAQUE CRITÈRE CITE LE CORRIGÉ, MOT POUR MOT. La citation est recopiée depuis le corrigé fourni, caractère pour caractère. Elle sera vérifiée contre le texte réel. Un critère dont la citation ne s'y retrouve pas fait rejeter la proposition entière.

2. N'AJOUTEZ RIEN QUE LE CORRIGÉ NE DISE. C'est la règle la plus importante, et la plus tentante à enfreindre. Vous connaissez probablement la matière mieux que ne l'exige ce corrigé : vous verrez des éléments manquants, des précisions utiles, des pièges classiques. Ne les ajoutez pas. Un critère pédagogiquement juste mais absent du corrigé deviendrait un critère du barème — donc une note, pour tous les étudiants, sur un attendu que leur enseignant n'a jamais formulé et qu'ils n'avaient aucun moyen de deviner.

3. DÉCOUPEZ SELON CE QUI SE JUGE, PAS SELON LES PHRASES. Un critère doit pouvoir être déclaré présent ou absent dans une copie, indépendamment des autres. Deux idées dans une même phrase du corrigé font deux critères ; une idée développée sur trois phrases n'en fait qu'un.

4. VOUS NE DONNEZ PAS DE POINTS. Le barème de la question est fixé par l'enseignant. Vous indiquez un poids relatif de 1 à 5 ; la conversion en points est arithmétique et ne vous appartient pas. Si les critères se valent, mettez 1 partout — c'est le cas le plus fréquent et le plus honnête.

5. SIGNALEZ CE QUE VOUS N'AVEZ PAS COUVERT. Un passage du corrigé qui n'entre dans aucun critère doit figurer dans passagesNonCouverts. Le taire donnerait l'illusion d'un découpage complet.

LES FORMULATIONS ACCEPTABLES

Pour chaque critère, listez les tournures qu'une copie peut employer : synonymes, sigles, abréviations usuelles, formulations équivalentes. Elles servent à reconnaître la réponse d'un étudiant qui n'emploie pas les mots exacts du corrigé. Restez dans le registre du corrigé : n'inventez pas de synonymes savants que l'enseignant n'accepterait pas.

LONGUEURS

Un intitulé ne dépasse pas 200 caractères, une citation 1000, une formulation acceptable 200. Ces limites ne sont pas décoratives : un dépassement fait échouer la validation.

Vous répondez en français.`

/** Compose le message utilisateur d'une demande de proposition. */
export function composerMessageBarème(request: RubricDraftRequest): string {
  return [
    '## Question posée',
    request.questionPrompt,
    '',
    '## Corrigé rédigé par l’enseignant',
    "C'est de ce texte, et de lui seul, que doivent provenir vos critères et vos citations.",
    '',
    request.answerKeyText,
    '',
    '## Barème de la question',
    `${(request.maxPoints / 1000).toLocaleString('fr-FR')} point(s) au total. ` +
      'Vous ne répartissez pas ces points : vous indiquez seulement des poids relatifs.',
  ].join('\n')
}

/** Message de reprise après une proposition non conforme. */
export function composerRepriseBarème(problèmes: readonly string[]): string {
  return [
    "Votre proposition n'a pas passé la validation. Défauts constatés :",
    '',
    ...problèmes.map((p) => `- ${p}`),
    '',
    'Reprenez la proposition complète en corrigeant ces points. Rappels :',
    '- chaque citation est recopiée mot pour mot depuis le corrigé fourni ;',
    "- aucun critère ne peut porter sur un attendu absent du corrigé, si juste soit-il ;",
    '- les longueurs maximales sont 200, 1000 et 200 caractères.',
    '',
    "Répondez par la proposition corrigée complète, pas par un correctif partiel.",
  ].join('\n')
}
