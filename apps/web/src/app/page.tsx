import { redirect } from 'next/navigation'

import { getCurrentUser } from '~/lib/session'

export default async function Accueil() {
  const user = await getCurrentUser()
  redirect(user ? '/tableau-de-bord' : '/connexion')
}
