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
export * from './estimate'
export * from './rubric-draft'
export {
  createMockOcrProvider,
  createMockTextAnalysisProvider,
  type MockAnalysisOptions,
  type MockOcrOptions,
  type TranscriptionFixtures,
} from './mock/index'
export {
  createAnthropicTextAnalysisProvider,
  MODELE_PAR_DEFAUT,
  type AnthropicAnalysisOptions,
  type ClientAnalyse,
  type DiagnosticAnalyse,
} from './anthropic/index'
export { VERSION_INVITE } from './anthropic/prompt'
