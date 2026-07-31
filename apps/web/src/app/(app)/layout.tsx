import Link from 'next/link'

import { ROLE_LABELS } from '@coteris/auth'

import { organizationName, requireUser } from '~/lib/session'
import { BoutonDeconnexion } from '~/components/deconnexion'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const org = await organizationName(user.principal.organizationId)

  const rôles = user.principal.roles.map((r) => ROLE_LABELS[r]).join(' · ')

  return (
    <div className="min-h-screen">
      <header className="border-b border-marine-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/tableau-de-bord" className="font-titre text-lg font-semibold text-marine-700">
              Coteris
            </Link>
            <nav className="flex gap-1 text-sm">
              <Lien href="/tableau-de-bord">Tableau de bord</Lien>
              <Lien href="/historique">Historique</Lien>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-anthracite-400">
                {org} · {rôles}
              </p>
            </div>
            <BoutonDeconnexion />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}

function Lien({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-anthracite-600 transition hover:bg-marine-50 hover:text-marine-700"
    >
      {children}
    </Link>
  )
}
