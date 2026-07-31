'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { authClient } from '~/lib/auth-client'

type Mode = 'connexion' | 'inscription'

export function FormulaireConnexion() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('connexion')
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [nom, setNom] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function soumettre(event: FormEvent) {
    event.preventDefault()
    setErreur(null)
    setEnCours(true)

    try {
      const résultat =
        mode === 'connexion'
          ? await authClient.signIn.email({ email, password: motDePasse })
          : await authClient.signUp.email({ email, password: motDePasse, name: nom })

      if (résultat.error) {
        // Le message d'erreur reste volontairement générique : préciser
        // « adresse inconnue » permettrait d'énumérer les comptes existants.
        setErreur(
          mode === 'connexion'
            ? 'Adresse électronique ou mot de passe incorrect.'
            : (résultat.error.message ?? 'La création du compte a échoué.'),
        )
        return
      }

      router.push('/tableau-de-bord')
      router.refresh()
    } catch {
      setErreur('Le service est momentanément indisponible. Réessayez dans un instant.')
    } finally {
      setEnCours(false)
    }
  }

  const champ =
    'w-full rounded-md border border-marine-100 bg-white px-3 py-2 text-sm ' +
    'placeholder:text-anthracite-400 focus:border-petrole-600 focus:outline-none'

  return (
    <form
      onSubmit={soumettre}
      className="rounded-lg border border-marine-100 bg-white p-6 shadow-[0_1px_2px_rgba(13,46,103,0.04)]"
    >
      <div className="mb-5 flex rounded-md bg-marine-50 p-0.5 text-sm">
        {(['connexion', 'inscription'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m)
              setErreur(null)
            }}
            className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
              mode === m ? 'bg-white text-marine-700 shadow-sm' : 'text-anthracite-600'
            }`}
          >
            {m === 'connexion' ? 'Se connecter' : 'Créer un compte'}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {mode === 'inscription' && (
          <div>
            <label htmlFor="nom" className="mb-1 block text-sm font-medium">
              Nom
            </label>
            <input
              id="nom"
              type="text"
              required
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className={champ}
              autoComplete="name"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Adresse électronique
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={champ}
            autoComplete="email"
            placeholder="coordinateur@demo.coteris.local"
          />
        </div>

        <div>
          <label htmlFor="motdepasse" className="mb-1 block text-sm font-medium">
            Mot de passe
          </label>
          <input
            id="motdepasse"
            type="password"
            required
            minLength={12}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            className={champ}
            autoComplete={mode === 'connexion' ? 'current-password' : 'new-password'}
          />
          {mode === 'inscription' && (
            <p className="mt-1 text-xs text-anthracite-400">Au moins 12 caractères.</p>
          )}
        </div>
      </div>

      {erreur && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-rouge-bd bg-rouge-bg px-3 py-2 text-sm text-rouge-fg"
        >
          {erreur}
        </p>
      )}

      <button
        type="submit"
        disabled={enCours}
        className="mt-6 w-full rounded-md bg-marine-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-marine-600 disabled:opacity-60"
      >
        {enCours
          ? 'Un instant…'
          : mode === 'connexion'
            ? 'Se connecter'
            : 'Créer le compte'}
      </button>
    </form>
  )
}
