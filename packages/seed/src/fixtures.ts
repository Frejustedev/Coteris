/**
 * Données de démonstration — entièrement fictives.
 *
 * Aucune donnée personnelle réelle n'apparaît ici, ni dans les tests, ni dans les
 * commentaires. Les noms d'étudiants sont inventés, les copies sont simulées.
 *
 * Le contenu médical est celui du scénario de la section 39 du cahier des
 * charges : une épreuve de médecine nucléaire, cinq questions courtes.
 */

export const ORGANIZATION = {
  name: 'Faculté de médecine de démonstration',
  slug: 'faculte-demo',
} as const

/** Comptes de démonstration. Les mots de passe sont posés par Better Auth. */
export const USERS = [
  {
    key: 'coordinateur',
    name: 'A. Coordinateur',
    email: 'coordinateur@demo.coteris.local',
    role: 'coordinator',
  },
  {
    key: 'correcteur1',
    name: 'B. Correcteur',
    email: 'correcteur1@demo.coteris.local',
    role: 'grader',
  },
  {
    key: 'correcteur2',
    name: 'C. Correcteur',
    email: 'correcteur2@demo.coteris.local',
    role: 'grader',
  },
] as const

/** Dix étudiants fictifs, désignés par un matricule inventé. */
export const STUDENTS = Array.from({ length: 10 }, (_, i) => ({
  externalRef: `ETU-2026-${String(i + 1).padStart(3, '0')}`,
  firstName: `Prénom${i + 1}`,
  lastName: `Nomfictif${i + 1}`,
  cohort: 'DES Médecine nucléaire — promotion de démonstration',
}))

export const ASSESSMENT = {
  title: 'Médecine nucléaire — épreuve de démonstration',
  subject: 'Médecine nucléaire',
  level: 'Troisième cycle',
  cohort: 'DES Médecine nucléaire',
  institution: 'Faculté de médecine de démonstration',
  durationMinutes: 60,
  language: 'fr',
  /** 5 points au total, en millièmes. */
  maxPoints: 5000,
  description:
    "Épreuve de démonstration à cinq questions courtes, destinée à illustrer la chaîne " +
    'de correction assistée de Coteris.',
  estimatedCandidates: 10,
} as const

export interface SeedCriterion {
  readonly key: string
  readonly label: string
  readonly attribution: 'all_or_nothing' | 'partial' | 'per_element'
  /** En millièmes de point. */
  readonly maxPoints: number
  readonly acceptableAnswers: readonly string[]
  readonly expectedElementCount?: number
  readonly partialRatioPercent?: number
}

export interface SeedQuestion {
  readonly number: string
  readonly prompt: string
  readonly type: 'short_answer' | 'short_essay' | 'clinical_case'
  /** En millièmes de point. */
  readonly maxPoints: number
  readonly answerKey: string
  readonly criteria: readonly SeedCriterion[]
}

export const QUESTIONS: readonly SeedQuestion[] = [
  {
    number: '1',
    prompt:
      "Pourquoi administre-t-on de l'iode stable avant certaines explorations à la MIBG ?",
    type: 'short_answer',
    maxPoints: 1000,
    answerKey:
      "L'iode stable permet de saturer ou bloquer la thyroïde afin de réduire sa captation " +
      "d'iode radioactif libre.",
    criteria: [
      {
        key: 'q1-iode',
        label: "Mention de l'iode stable",
        attribution: 'all_or_nothing',
        maxPoints: 250,
        acceptableAnswers: ['iode stable', 'iode non radioactif', 'iodure de potassium'],
      },
      {
        key: 'q1-thyroide',
        label: 'Protection ou blocage de la thyroïde',
        attribution: 'all_or_nothing',
        maxPoints: 250,
        acceptableAnswers: [
          'protéger la thyroïde',
          'bloquer la thyroïde',
          'saturer la thyroïde',
          'protection thyroïdienne',
        ],
      },
      {
        key: 'q1-captation',
        label: "Réduction de la captation d'iode radioactif libre",
        attribution: 'all_or_nothing',
        maxPoints: 500,
        acceptableAnswers: [
          'réduire la captation',
          "captation d'iode radioactif libre",
          "éviter la fixation de l'iode libre",
        ],
      },
    ],
  },
  {
    number: '2',
    prompt: 'Citez deux indications de la scintigraphie osseuse.',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey:
      'Bilan d’extension des métastases osseuses, recherche de fracture de fatigue, ' +
      'bilan d’une prothèse douloureuse, maladie de Paget.',
    criteria: [
      {
        key: 'q2-indications',
        label: 'Indications citées',
        attribution: 'per_element',
        maxPoints: 1000,
        expectedElementCount: 2,
        acceptableAnswers: [
          'métastases osseuses',
          'fracture de fatigue',
          'prothèse douloureuse',
          'maladie de Paget',
        ],
      },
    ],
  },
  {
    number: '3',
    prompt: "Qu'est-ce que la période effective d'un radiopharmaceutique ?",
    type: 'short_answer',
    maxPoints: 1000,
    answerKey:
      'La période effective combine la période physique de décroissance radioactive et la ' +
      "période biologique d'élimination de l'organisme.",
    criteria: [
      {
        key: 'q3-physique',
        label: 'Mention de la période physique',
        attribution: 'all_or_nothing',
        maxPoints: 400,
        acceptableAnswers: ['période physique', 'décroissance radioactive', 'demi-vie physique'],
      },
      {
        key: 'q3-biologique',
        label: 'Mention de la période biologique',
        attribution: 'all_or_nothing',
        maxPoints: 400,
        acceptableAnswers: ['période biologique', 'élimination biologique', 'demi-vie biologique'],
      },
      {
        key: 'q3-combinaison',
        label: 'Notion de combinaison des deux',
        attribution: 'partial',
        maxPoints: 200,
        partialRatioPercent: 50,
        acceptableAnswers: ['combine', 'combinaison', 'les deux'],
      },
    ],
  },
  {
    number: '4',
    prompt: 'Quel radionucléide est le plus utilisé en imagerie conventionnelle, et pourquoi ?',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey:
      "Le technétium 99m, en raison de sa période courte d'environ six heures, de son " +
      'émission gamma pure à 140 keV et de sa disponibilité par générateur.',
    criteria: [
      {
        key: 'q4-technetium',
        label: 'Identification du technétium 99m',
        attribution: 'all_or_nothing',
        maxPoints: 400,
        acceptableAnswers: ['technétium', 'technetium', 'Tc-99m', '99mTc'],
      },
      {
        key: 'q4-proprietes',
        label: 'Propriétés justifiant son usage',
        attribution: 'per_element',
        maxPoints: 600,
        expectedElementCount: 2,
        acceptableAnswers: ['période courte', '140 keV', 'gamma pur', 'générateur'],
      },
    ],
  },
  {
    number: '5',
    prompt:
      'Une patiente enceinte doit bénéficier d’une scintigraphie pulmonaire. ' +
      'Quelle est la conduite à tenir ?',
    type: 'clinical_case',
    maxPoints: 1000,
    answerKey:
      "Évaluer le rapport bénéfice-risque, privilégier l'échographie ou une alternative non " +
      "irradiante, réduire l'activité injectée et assurer une hydratation avec mictions " +
      'fréquentes si l’examen est maintenu.',
    criteria: [
      {
        key: 'q5-benefice',
        label: 'Évaluation du rapport bénéfice-risque',
        attribution: 'all_or_nothing',
        maxPoints: 400,
        acceptableAnswers: ['bénéfice-risque', 'balance bénéfice', 'rapport bénéfice'],
      },
      {
        key: 'q5-alternative',
        label: "Recherche d'une alternative non irradiante",
        attribution: 'all_or_nothing',
        maxPoints: 300,
        acceptableAnswers: ['échographie', 'alternative non irradiante', 'examen non irradiant'],
      },
      {
        key: 'q5-precautions',
        label: "Réduction de l'activité et précautions",
        attribution: 'partial',
        maxPoints: 300,
        partialRatioPercent: 50,
        acceptableAnswers: ['réduire l’activité', 'hydratation', 'mictions fréquentes'],
      },
    ],
  },
]

/**
 * Copies simulées.
 *
 * Volontairement variées, pour produire des décisions vertes, orange et rouges,
 * ainsi qu'une réponse correcte non prévue au corrigé.
 */
export interface SeedSubmission {
  readonly anonymousCode: string
  readonly studentIndex: number
  /** Transcription simulée par question, indexée par numéro de question. */
  readonly answers: Readonly<Record<string, string>>
  /** Confiance OCR simulée. Permet de produire des cas orange et rouges. */
  readonly ocrConfidence?: number
  readonly uncertainWords?: readonly string[]
  /** Extraits corrects mais absents du corrigé. */
  readonly unexpectedExcerpts?: readonly string[]
  readonly note?: string
}

export const SUBMISSIONS: readonly SeedSubmission[] = [
  {
    anonymousCode: 'ANON-001',
    studentIndex: 0,
    note: 'Cas vert : réponses nettes, lecture fiable.',
    answers: {
      '1': "L'iode stable permet de bloquer la thyroïde et de réduire la captation d'iode radioactif libre.",
      '2': 'Bilan des métastases osseuses et recherche de fracture de fatigue.',
      '3': 'La période effective combine la période physique et la période biologique.',
      '4': 'Le technétium 99m, car il a une période courte et émet un gamma pur.',
      '5': "Évaluer le rapport bénéfice-risque et proposer une échographie si possible.",
    },
  },
  {
    anonymousCode: 'ANON-002',
    studentIndex: 1,
    note: 'Le cas exact du cahier des charges : deux critères sur trois en question 1.',
    answers: {
      '1': "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection.",
      '2': 'Les métastases osseuses.',
      '3': 'Elle correspond à la décroissance radioactive du produit.',
      '4': 'Le technétium.',
      '5': "Il faut évaluer le rapport bénéfice-risque avant de décider.",
    },
  },
  {
    anonymousCode: 'ANON-003',
    studentIndex: 2,
    note: 'Cas orange : lecture douteuse sur plusieurs mots.',
    ocrConfidence: 0.72,
    uncertainWords: ['thyroïde', 'biologique'],
    answers: {
      '1': "On donne de l'iode stable pour protéger la thyroïde.",
      '2': 'Métastases osseuses et prothèse douloureuse.',
      '3': 'Combinaison de la période physique et de la période biologique.',
      '4': 'Le technétium 99m avec son générateur.',
      '5': "Évaluer le rapport bénéfice-risque, réduire l’activité injectée.",
    },
  },
  {
    anonymousCode: 'ANON-004',
    studentIndex: 3,
    note: 'Cas rouge : scan de mauvaise qualité, transcription peu fiable.',
    ocrConfidence: 0.31,
    answers: {
      '1': "Iode stable pour la thyroïde.",
      '2': 'Métastases.',
      '3': 'Période physique.',
      '4': 'Technétium.',
      '5': 'Bénéfice-risque.',
    },
  },
  {
    anonymousCode: 'ANON-005',
    studentIndex: 4,
    note: 'Réponse correcte non prévue au corrigé, en question 4.',
    unexpectedExcerpts: ['faible dose absorbée pour le patient'],
    answers: {
      '1': "L'iode stable sature la thyroïde et réduit la captation d'iode radioactif libre.",
      '2': 'Fracture de fatigue et maladie de Paget.',
      '3': 'Elle combine la période physique et la période biologique.',
      '4':
        'Le technétium 99m, pour sa période courte, son émission à 140 keV, et parce qu’il ' +
        'entraîne une faible dose absorbée pour le patient.',
      '5': "Rapport bénéfice-risque, échographie en alternative, hydratation.",
    },
  },
  {
    anonymousCode: 'ANON-006',
    studentIndex: 5,
    note: 'Copie partiellement blanche.',
    answers: {
      '1': "Pour protéger la thyroïde.",
      '2': '',
      '3': '',
      '4': 'Le technétium 99m.',
      '5': '',
    },
  },
]
