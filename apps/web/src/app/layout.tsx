import type { Metadata } from 'next'
import { Inter, Manrope } from 'next/font/google'

import './globals.css'

const titre = Manrope({
  subsets: ['latin'],
  variable: '--police-titre',
  display: 'swap',
})

const texte = Inter({
  subsets: ['latin'],
  variable: '--police-texte',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Coteris',
    template: '%s · Coteris',
  },
  description:
    'Correction académique assistée : importer des copies, appliquer un barème validé, ' +
    'proposer une note justifiée, laisser l’enseignant décider.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${titre.variable} ${texte.variable}`}>
      <body className="min-h-screen bg-fond text-anthracite-800">{children}</body>
    </html>
  )
}
