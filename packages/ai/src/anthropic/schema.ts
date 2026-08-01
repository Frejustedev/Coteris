/**
 * Schéma JSON transmis au modèle via `output_config.format`.
 *
 * Il reproduit `analysisResultSchema` (../analysis.ts), qui reste la seule
 * autorité : ce schéma-ci contraint la génération, celui-là valide le résultat.
 *
 * DEUX ÉCARTS DÉLIBÉRÉS, ET LEURS RAISONS
 *
 * 1. **Aucune borne de longueur n'y figure.** Les sorties structurées ne
 *    supportent ni `minLength`/`maxLength`, ni `minimum`/`maximum`, ni les
 *    contraintes de tableau : les SDK les retirent du schéma envoyé à l'API et ne
 *    les vérifient que côté client. Les écrire ici donnerait l'illusion d'une
 *    garantie inexistante. Les bornes sont donc rappelées en langage naturel dans
 *    l'invite, puis **imposées côté fournisseur** avant de retourner l'analyse.
 *
 * 2. **`matchedElementCount` est obligatoire ici alors qu'il est optionnel dans
 *    zod.** En aval, son absence reçoit trois valeurs par défaut différentes
 *    selon le chemin — 1 pour un critère présent, 0 pour un critère partiel,
 *    0 à l'écriture en base. Sur un critère noté par élément, cet écart change
 *    directement les points attribués. Exiger le champ supprime la question.
 */

/** Un identifiant de critère, recopié du barème. */
const identifiantCritere = {
  type: 'string',
  format: 'uuid',
  description:
    "Identifiant du critère, recopié CARACTÈRE POUR CARACTÈRE depuis la liste fournie. " +
    "N'invente jamais un identifiant : un identifiant absent du barème invalide toute l'analyse.",
} as const

const detection = {
  type: 'object',
  additionalProperties: false,
  required: ['criterionId', 'excerpts', 'matchedElementCount'],
  properties: {
    criterionId: identifiantCritere,
    excerpts: {
      type: 'array',
      description:
        "Extraits de la RÉPONSE DE L'ÉTUDIANT justifiant cet état, recopiés mot pour mot. " +
        "Au moins un, jamais zéro. Ne cite jamais le corrigé ni une réponse acceptable : " +
        "la preuve doit venir de la copie.",
      items: { type: 'string' },
    },
    matchedElementCount: {
      type: 'integer',
      description:
        "Nombre d'éléments attendus effectivement trouvés dans la réponse. Vaut 1 pour un " +
        'critère à élément unique. Sur un critère qui en attend plusieurs, ce nombre détermine ' +
        'directement les points : ne le laisse jamais à zéro si tu as fourni un extrait.',
    },
  },
} as const

const probleme = {
  type: 'object',
  additionalProperties: false,
  required: ['criterionId', 'excerpt', 'explanation'],
  properties: {
    criterionId: identifiantCritere,
    excerpt: {
      type: 'string',
      description: "Extrait de la copie, mot pour mot, sur lequel porte le problème.",
    },
    explanation: {
      type: 'string',
      description: 'Explication en français, 500 caractères maximum.',
    },
  },
} as const

/**
 * Schéma racine. Les neuf clés sont obligatoires, y compris quand la liste
 * correspondante est vide : `analysisResultSchema` n'admet aucune valeur par
 * défaut à la racine, et une clé manquante fait échouer le parse — donc, en
 * l'état du pipeline, tomber la question à zéro.
 */
export const SCHEMA_ANALYSE = {
  type: 'object',
  additionalProperties: false,
  required: [
    'presentCriteria',
    'partialCriteria',
    'missingCriteria',
    'contradictions',
    'factualErrors',
    'unexpectedElements',
    'uncertainSpans',
    'needsHumanReview',
    'matchClarity',
  ],
  properties: {
    presentCriteria: {
      type: 'array',
      description: "Critères dont l'élément attendu est présent et correct dans la réponse.",
      items: detection,
    },
    partialCriteria: {
      type: 'array',
      description: "Critères présents mais incomplets, imprécis ou partiellement traités.",
      items: detection,
    },
    missingCriteria: {
      type: 'array',
      description:
        "Identifiants des critères absents de la réponse. Un critère absent n'a, par " +
        "définition, pas d'extrait justificatif.",
      items: identifiantCritere,
    },
    contradictions: {
      type: 'array',
      description:
        "Critères que la copie affirme puis contredit ailleurs. Orthogonal à l'état : ne " +
        'signale une contradiction que sur un critère classé présent ou partiel.',
      items: probleme,
    },
    factualErrors: {
      type: 'array',
      description:
        "Critères traités mais factuellement faux. Orthogonal à l'état : ne signale une " +
        'erreur factuelle que sur un critère classé présent ou partiel.',
      items: probleme,
    },
    unexpectedElements: {
      type: 'array',
      description:
        "Éléments corrects présents dans la copie mais absents du corrigé. Ils ne rapportent " +
        'pas de points ; ils alertent sur un barème peut-être incomplet.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['excerpt', 'explanation', 'nearestCriterionId'],
        properties: {
          excerpt: { type: 'string', description: 'Extrait de la copie, mot pour mot.' },
          explanation: { type: 'string', description: 'Explication, 500 caractères maximum.' },
          nearestCriterionId: {
            anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
            description: "Critère du barème le plus proche, ou null s'il n'y en a aucun.",
          },
        },
      },
    },
    uncertainSpans: {
      type: 'array',
      description:
        "Passages de la copie que tu ne lis pas avec certitude. Ils font baisser la confiance " +
        "et déclenchent une relecture humaine : n'en signale que de réels.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['excerpt', 'reason'],
        properties: {
          excerpt: {
            type: 'string',
            description: 'Extrait de la copie, mot pour mot. Il sera vérifié contre la copie.',
          },
          reason: { type: 'string', description: 'Raison du doute, 300 caractères maximum.' },
        },
      },
    },
    needsHumanReview: {
      type: 'boolean',
      description: 'Toujours true : aucune proposition de note ne contourne la validation humaine.',
    },
    matchClarity: {
      type: 'number',
      description:
        "Netteté de la correspondance entre la réponse et le barème, entre 0 et 1. " +
        "Ce n'est pas la qualité de la copie : une copie franchement fausse mais sans " +
        'ambiguïté mérite une netteté élevée. Réserve les valeurs hautes aux cas où un ' +
        'second correcteur trancherait à coup sûr comme toi.',
    },
  },
} as const
