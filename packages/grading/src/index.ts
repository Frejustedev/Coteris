/**
 * @coteris/grading — moteur de barème déterministe.
 *
 * Ce paquet ne dépend que de `@coteris/shared`. Il n'accède ni à la base, ni au
 * réseau, ni à l'horloge (règle imposée par ESLint). C'est ce qui permet de le
 * tester exhaustivement en mémoire et de garantir qu'une note recalculée dans
 * dix ans donnera la même valeur.
 */

export * from './types'
export {
  gradeQuestion,
  totalForSubmission,
  maxForSubmission,
  hasUnjustifiedCriteria,
} from './engine'
