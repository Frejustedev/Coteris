import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '~/lib/session'
import { FormulaireConnexion } from './formulaire'

export const metadata: Metadata = { title: 'Connexion' }

export default async function Connexion() {
  if (await getCurrentUser()) redirect('/tableau-de-bord')

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-titre text-3xl font-semibold text-marine-700">Coteris</h1>
          <p className="mt-2 text-sm text-anthracite-600">
            Correction assistée. La note reste la décision de l’enseignant.
          </p>
        </div>

        <FormulaireConnexion />

        <p className="mt-6 text-center text-xs leading-relaxed text-anthracite-400">
          Coteris produit une proposition de correction, jamais une note définitive.
          Chaque point proposé est adossé à un extrait de la copie.
        </p>
      </div>
    </main>
  )
}
