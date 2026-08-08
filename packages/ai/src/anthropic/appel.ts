/**
 * Plomberie d'appel commune aux fournisseurs Anthropic.
 *
 * Deux fournisseurs vivent maintenant côte à côte — l'analyse d'une réponse et
 * la proposition d'un barème — et ils partagent tout sauf leur invite et leur
 * schéma de sortie. Recopier cette plomberie serait le premier pas vers deux
 * comportements qui divergent en silence : un `stop_reason` vérifié d'un côté et
 * pas de l'autre, un solde épuisé rejoué neuf fois ici et pas là.
 *
 * Ce fichier n'introduit aucun comportement : il déplace celui qui était déjà
 * éprouvé par les tests du fournisseur d'analyse.
 */

import {
  APIConnectionError,
  APIError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk'
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages'
import type {
  BatchCreateParams,
  MessageBatch,
  MessageBatchIndividualResponse,
} from '@anthropic-ai/sdk/resources/messages/batches'

import { ProviderError } from '../providers'

/** Sous-ensemble du client SDK réellement utilisé, pour pouvoir l'injecter en test. */
export interface ClientAnalyse {
  readonly messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>
    /** Absent d'un client de test qui n'éprouve que le chemin unitaire. */
    readonly batches?: {
      create(params: BatchCreateParams): Promise<MessageBatch>
      retrieve(id: string): Promise<MessageBatch>
      results(id: string): Promise<AsyncIterable<MessageBatchIndividualResponse>>
    }
  }
}

export type NiveauEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface Reglages {
  readonly modele: string
  readonly effort: NiveauEffort
  readonly maxTokens: number
}

/**
 * Paramètres d'un appel à sortie structurée.
 *
 * L'invite et le schéma sont des paramètres : c'est tout ce qui distingue une
 * analyse de réponse d'une proposition de barème.
 */
export function construireParams(
  reglages: Reglages,
  messages: readonly MessageParam[],
  invite: string,
  schema: Record<string, unknown>,
): MessageCreateParamsNonStreaming {
  return {
    model: reglages.modele,
    max_tokens: reglages.maxTokens,
    system: invite,
    messages: [...messages],
    output_config: {
      effort: reglages.effort,
      format: { type: 'json_schema', schema },
    },
  }
}

/** Concatène les blocs de texte de la réponse. */
export function texteDe(message: Message): string {
  return message.content
    .filter((bloc): bloc is Extract<typeof bloc, { type: 'text' }> => bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('')
}

/**
 * Vérifie `stop_reason` **avant** toute lecture du contenu.
 *
 * Un refus des classificateurs de sûreté revient en HTTP 200 avec un contenu
 * vide ; une troncature revient avec un JSON coupé au milieu. Dans les deux cas,
 * lire `content` sans vérifier produit une sortie fantôme.
 */
export function verifierArret(message: Message, modele: string): void {
  const raison = message.stop_reason

  if (raison === 'refusal') {
    const details = message.stop_details
    const categorie =
      details !== null && details !== undefined && 'category' in details
        ? (details.category ?? 'non précisée')
        : 'non précisée'
    throw new ProviderError(
      'anthropic',
      `Le modèle ${modele} a refusé cette demande (catégorie : ${categorie}). ` +
        `Elle doit être traitée à la main ; elle ne doit pas être conclue par défaut.`,
      false,
    )
  }

  if (raison === 'max_tokens') {
    throw new ProviderError(
      'anthropic',
      `Réponse tronquée : le plafond de jetons de sortie a été atteint. Sur ce modèle le ` +
        `raisonnement partage ce plafond avec la réponse — augmentez maxTokens.`,
      true,
    )
  }

  if (raison === 'model_context_window_exceeded') {
    throw new ProviderError(
      'anthropic',
      'La fenêtre de contexte est dépassée : le texte transmis est trop long.',
      false,
    )
  }

  if (raison !== 'end_turn' && raison !== 'stop_sequence') {
    throw new ProviderError(
      'anthropic',
      `Arrêt inattendu du modèle (« ${raison ?? 'null'} »).`,
      false,
    )
  }
}

/**
 * Traduit une erreur du SDK, en distinguant ce qui mérite une nouvelle tentative
 * de ce qui n'en mérite aucune.
 *
 * Un solde de crédit épuisé, une clé révoquée, un modèle inconnu : trois erreurs
 * qu'aucune reprise ne corrige. Sans ce tri, la file de travaux rejoue la tâche
 * trois fois et le SDK ajoute les siennes — jusqu'à neuf appels pour un échec
 * certain.
 *
 * Le tri se fait sur les classes typées du SDK, jamais sur le texte du message :
 * un message change sans préavis, une classe non.
 */
export function erreurFournisseur(erreur: unknown): ProviderError {
  if (erreur instanceof RateLimitError) {
    return new ProviderError('anthropic', `Débit dépassé : ${erreur.message}`, true)
  }
  if (erreur instanceof InternalServerError) {
    return new ProviderError('anthropic', `Service indisponible : ${erreur.message}`, true)
  }
  if (erreur instanceof APIConnectionError) {
    return new ProviderError('anthropic', `Connexion en échec : ${erreur.message}`, true)
  }
  if (erreur instanceof APIError) {
    return new ProviderError(
      'anthropic',
      `Requête refusée (${erreur.status ?? '?'}) : ${erreur.message}`,
      false,
    )
  }
  const details = erreur instanceof Error ? erreur.message : String(erreur)
  return new ProviderError('anthropic', `Appel au modèle en échec : ${details}`, true)
}

/**
 * Total des jetons d'entrée facturés, écriture et lecture de cache comprises.
 *
 * `input_tokens` ne compte que le reliquat non caché : ignorer les deux autres
 * compteurs ferait facturer une fraction du coût réel.
 */
export function jetonsEntree(message: Message): number {
  const u = message.usage
  return (
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  )
}

export const attendre = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
