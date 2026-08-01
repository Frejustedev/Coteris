import type { Metadata } from 'next'
import Link from 'next/link'

import { can } from '@coteris/auth'

import { Carte, Vide } from '~/components/ui'
import { requireUser } from '~/lib/session'
import { FormulaireÉpreuve } from './formulaire'

export const metadata: Metadata = { title: 'Nouvelle épreuve' }

export default async function NouvelleÉpreuve() {
  const { principal } = await requireUser()

  // Contrôle côté serveur : masquer le lien dans la navigation ne suffirait pas.
  if (!can(principal, 'assessment', 'create')) {
    return <Vide>Votre rôle ne permet pas de créer une épreuve.</Vide>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/tableau-de-bord" className="text-sm text-anthracite-400 hover:text-marine-600">
          ← Toutes les épreuves
        </Link>
        <h1 className="mt-2 font-titre text-2xl font-semibold text-marine-700">
          Nouvelle épreuve
        </h1>
        <p className="mt-1 text-sm text-anthracite-600">
          Vous ajouterez ensuite les questions, le corrigé et le barème. Rien n’est
          définitif tant que le barème n’est pas verrouillé.
        </p>
      </div>

      <Carte>
        <FormulaireÉpreuve />
      </Carte>
    </div>
  )
}
