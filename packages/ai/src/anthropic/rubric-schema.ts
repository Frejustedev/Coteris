/**
 * Schéma JSON de la proposition de barème, transmis via `output_config.format`.
 *
 * Comme pour l'analyse, les bornes de longueur n'y figurent pas : les sorties
 * structurées ne les transportent pas. Elles sont rappelées dans l'invite et
 * réimposées côté fournisseur.
 *
 * Deux champs sont volontairement ABSENTS : les identifiants et les points. Le
 * modèle propose un découpage, pas une grille prête à noter. Les identifiants
 * sont attribués à l'enregistrement, et les points calculés par répartition
 * exacte du barème que l'enseignant a fixé.
 */

export const SCHEMA_BAREME = {
  type: 'object',
  additionalProperties: false,
  required: ['critères', 'passagesNonCouverts'],
  properties: {
    critères: {
      type: 'array',
      description:
        "Un critère par élément que le corrigé attend. Découpez selon ce qui peut être " +
        'jugé présent ou absent indépendamment dans une copie, pas selon la structure ' +
        'des phrases du corrigé.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'citation', 'acceptableAnswers', 'poids'],
        properties: {
          label: {
            type: 'string',
            description:
              "Intitulé court, tel qu'il figurera dans la grille de correction. " +
              'Une notion, pas une phrase. 200 caractères maximum.',
          },
          citation: {
            type: 'string',
            description:
              'Passage du CORRIGÉ dont ce critère est tiré, recopié mot pour mot. ' +
              "Il sera vérifié contre le texte : un critère dont la citation ne s'y " +
              "retrouve pas fait rejeter toute la proposition. N'inventez rien, même " +
              'si vous savez que ce serait pédagogiquement juste.',
          },
          acceptableAnswers: {
            type: 'array',
            description:
              "Formulations qu'une copie peut employer pour satisfaire ce critère : " +
              'synonymes, sigles, tournures équivalentes. Elles servent à reconnaître la ' +
              "réponse d'un étudiant qui n'emploie pas les mots du corrigé.",
            items: { type: 'string' },
          },
          poids: {
            type: 'integer',
            description:
              "Importance relative du critère, de 1 à 5. Ce n'est PAS un nombre de " +
              "points : le barème de la question est fixé par l'enseignant et sera " +
              'réparti selon ces poids. Utilisez 1 partout si les critères se valent.',
          },
        },
      },
    },
    passagesNonCouverts: {
      type: 'array',
      description:
        "Passages du corrigé que vous n'avez rattachés à aucun critère. Signalez-les " +
        "plutôt que de les omettre : un corrigé dont la moitié n'entre dans aucun " +
        "critère doit alerter l'enseignant.",
      items: { type: 'string' },
    },
  },
} as const
