import type { NextConfig } from 'next'

const config: NextConfig = {
  // Sortie autonome : c'est cet artefact qui est transféré vers l'hébergement.
  // Le build a lieu en intégration continue, jamais sur le serveur mutualisé,
  // dont la mémoire est insuffisante (voir docs/adr/0005-deploiement-portable.md).
  output: 'standalone',

  // Les paquets du monorepo sont du TypeScript source, pas des paquets publiés.
  transpilePackages: [
    '@coteris/shared',
    '@coteris/database',
    '@coteris/auth',
    '@coteris/audit',
    '@coteris/ai',
    '@coteris/grading',
    '@coteris/pipeline',
    '@coteris/storage',
    '@coteris/jobs',
  ],

  typescript: {
    // Le typage est vérifié par `pnpm typecheck` dans la CI, sur tout le
    // monorepo, et il l'est aussi ici : une erreur de type ne doit jamais
    // atteindre un artefact de production.
    ignoreBuildErrors: false,
  },
}

export default config
