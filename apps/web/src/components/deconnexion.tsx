'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { authClient } from '~/lib/auth-client'

export function BoutonDeconnexion() {
  const router = useRouter()
  const [enCours, setEnCours] = useState(false)

  return (
    <button
      type="button"
      disabled={enCours}
      onClick={async () => {
        setEnCours(true)
        await authClient.signOut()
        router.push('/connexion')
        router.refresh()
      }}
      className="rounded-md border border-marine-100 px-3 py-1.5 text-sm text-anthracite-600 transition hover:bg-marine-50 disabled:opacity-60"
    >
      {enCours ? '…' : 'Déconnexion'}
    </button>
  )
}
