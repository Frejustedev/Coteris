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
    '@coteris/exports',
  ],

  experimental: {
    serverActions: {
      // L'import de copies passe par une action serveur et un FormData. Sans
      // cette ligne, Next.js plafonne le corps à 1 Mo — alors que le service
      // d'import annonce accepter jusqu'à UPLOAD_MAX_FILE_SIZE_MB, 25 Mo par
      // défaut. L'utilisateur recevait donc un refus opaque sur toute copie
      // scannée un peu lourde.
      //
      // Aucun test ne le voyait : scripts/verify-import.ts appelle le service
      // directement, sans traverser la couche HTTP. Le défaut ne se manifestait
      // que dans le navigateur, c'est-à-dire uniquement chez l'utilisateur.
      bodySizeLimit: `${Number(process.env['UPLOAD_MAX_FILE_SIZE_MB'] ?? 25)}mb`,
    },
  },

  typescript: {
    // Le typage est vérifié par `pnpm typecheck` dans la CI, sur tout le
    // monorepo, et il l'est aussi ici : une erreur de type ne doit jamais
    // atteindre un artefact de production.
    ignoreBuildErrors: false,
  },
}

export default config
