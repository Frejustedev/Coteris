/**
 * @coteris/ai — abstractions des fournisseurs, validation des sorties, coûts.
 *
 * Ce paquet ne calcule jamais de points. Il produit des **états de critères**
 * accompagnés de preuves extraites de la copie ; le calcul revient au moteur
 * déterministe de `@coteris/grading`.
 */

export * from './analysis'
export * from './providers'
export * from './cost'
export {
  createMockOcrProvider,
  createMockTextAnalysisProvider,
  type MockAnalysisOptions,
  type MockOcrOptions,
  type TranscriptionFixtures,
} from './mock/index'
