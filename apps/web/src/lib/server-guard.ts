/**
 * Garde « côté serveur uniquement ».
 *
 * Le paquet `server-only` s'appuie sur une condition d'export propre au
 * compilateur de Next.js : il lève dès qu'on l'importe depuis un script Node
 * ordinaire, ce qui empêche de vérifier les services en ligne de commande — or
 * ce sont précisément les modules qu'on veut pouvoir tester.
 *
 * Cette garde vise la même chose et fonctionne partout : si le module se
 * retrouve dans un paquet client, `window` existe et l'erreur est immédiate.
 */
export function assertServerOnly(nomDuModule: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `${nomDuModule} ne doit jamais être chargé côté navigateur : il accède à la base ` +
        `de données et aux secrets du serveur.`,
    )
  }
}
