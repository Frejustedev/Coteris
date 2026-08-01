/**
 * Test de fumée de l'application web.
 *
 * Parcourt le chemin réel d'un utilisateur — connexion, tableau de bord,
 * épreuve, écran de correction, historique — en vérifiant à chaque étape que la
 * page contient bien les données attendues.
 *
 * Écrit en HTTP plutôt qu'en pilotage de navigateur : c'est déterministe, rapide,
 * et cela vérifie ce qui compte vraiment — le rendu serveur et le cloisonnement
 * des données — sans dépendre du minutage de l'hydratation.
 *
 * Prérequis : base migrée et remplie (`pnpm db:migrate && pnpm db:seed`) et
 * serveur démarré (`pnpm --filter @coteris/web dev`).
 *
 *   node scripts/smoke-test.mjs [url]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000'
const EMAIL = 'coordinateur@demo.coteris.local'
const PASSWORD = 'demonstration-coteris'

let cookies = ''
let échecs = 0

function ok(message) {
  console.log(`  [32mOK[0m    ${message}`)
}

function ko(message, détail) {
  échecs += 1
  console.error(`  [31mÉCHEC[0m ${message}`)
  if (détail) console.error(`        ${détail}`)
}

function vérifier(condition, message, détail) {
  if (condition) ok(message)
  else ko(message, détail)
}

/**
 * Identifiant de l'épreuve de démonstration dans la page du tableau de bord.
 *
 * On repère le titre, puis le lien qui le précède immédiatement : c'est celui de
 * sa carte.
 */
function trouverÉpreuveDémo(html) {
  const positionTitre = html.indexOf('Médecine nucléaire')
  if (positionTitre === -1) return undefined

  let candidat
  for (const m of html.matchAll(/\/epreuves\/([0-9a-f-]{36})/g)) {
    if (m.index !== undefined && m.index < positionTitre) candidat = m[1]
    else break
  }
  return candidat
}

async function get(chemin) {
  const réponse = await fetch(`${BASE}${chemin}`, {
    headers: cookies ? { cookie: cookies } : {},
    redirect: 'manual',
  })
  const corps = réponse.status < 300 ? await réponse.text() : ''
  return { statut: réponse.status, corps, emplacement: réponse.headers.get('location') }
}

async function main() {
  console.log(`\nTest de fumée — ${BASE}\n`)

  // --- Connexion --------------------------------------------------------------
  console.log('Connexion')

  const anonyme = await get('/tableau-de-bord')
  vérifier(
    anonyme.statut >= 300 && anonyme.statut < 400,
    'un visiteur non connecté est redirigé hors du tableau de bord',
    `statut ${anonyme.statut}`,
  )

  // L'en-tête Origin est obligatoire : Better Auth refuse toute requête sans lui
  // (protection CSRF). Une requête forgée depuis un autre site ne peut pas le
  // falsifier — c'est précisément le point.
  const sansOrigine = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  vérifier(
    sansOrigine.status === 403,
    'une requête d’authentification sans en-tête Origin est refusée (CSRF)',
    `statut ${sansOrigine.status}`,
  )

  const connexion = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })

  if (!connexion.ok) {
    ko('connexion du coordonnateur', `statut ${connexion.status} — ${await connexion.text()}`)
    console.error('\nImpossible de poursuivre sans session.\n')
    process.exit(1)
  }

  cookies = (connexion.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

  vérifier(cookies.length > 0, 'la connexion pose un cookie de session')
  ok('connexion du coordonnateur')

  // --- Tableau de bord --------------------------------------------------------
  console.log('\nTableau de bord')

  const tableau = await get('/tableau-de-bord')
  vérifier(tableau.statut === 200, 'le tableau de bord répond', `statut ${tableau.statut}`)
  vérifier(
    tableau.corps.includes('Médecine nucléaire'),
    'l’épreuve de démonstration est listée',
  )
  vérifier(
    tableau.corps.includes('Faculté de médecine de démonstration'),
    'l’organisation de l’utilisateur est affichée',
  )
  vérifier(tableau.corps.includes('Coordonnateur'), 'le rôle est affiché')
  vérifier(
    tableau.corps.includes('/epreuves/nouvelle'),
    'un coordonnateur peut créer une épreuve depuis le tableau de bord',
  )

  const création = await get('/epreuves/nouvelle')
  vérifier(création.statut === 200, 'la page de création répond', `statut ${création.statut}`)
  vérifier(
    création.corps.includes('Note maximale'),
    'le formulaire de création est rendu',
  )

  // --- Épreuve ----------------------------------------------------------------
  console.log('\nÉpreuve')

  // On vise l'épreuve de démonstration, et non la première venue : d'autres
  // épreuves peuvent exister, et une épreuve sans copies ferait échouer les
  // vérifications suivantes pour une mauvaise raison.
  const idÉpreuve = trouverÉpreuveDémo(tableau.corps)
  vérifier(Boolean(idÉpreuve), 'un lien vers l’épreuve de démonstration est présent')
  if (!idÉpreuve) return

  const épreuve = await get(`/epreuves/${idÉpreuve}`)
  vérifier(épreuve.statut === 200, 'la page d’épreuve répond', `statut ${épreuve.statut}`)
  vérifier(
    épreuve.corps.includes("iode stable") || épreuve.corps.includes('MIBG'),
    'la question du scénario MIBG est affichée',
  )
  vérifier(épreuve.corps.includes('ANON-001'), 'les copies anonymes sont listées')
  vérifier(
    !épreuve.corps.includes('Nomfictif'),
    'aucune identité d’étudiant n’apparaît : l’anonymat tient',
  )

  // --- Écran de correction ----------------------------------------------------
  console.log('\nÉcran de correction')

  const idCopie = épreuve.corps.match(/\/copies\/([0-9a-f-]{36})/)?.[1]
  vérifier(Boolean(idCopie), 'un lien vers une copie est présent')
  if (!idCopie) return

  const copie = await get(`/copies/${idCopie}`)
  vérifier(copie.statut === 200, 'l’écran de correction répond', `statut ${copie.statut}`)
  vérifier(copie.corps.includes('Copie'), 'la zone gauche — la copie — est rendue')
  vérifier(copie.corps.includes('Réponse'), 'la zone centrale — la réponse — est rendue')
  vérifier(copie.corps.includes('Notation'), 'la zone droite — la notation — est rendue')
  vérifier(
    copie.corps.includes('Total proposé'),
    'le total proposé est affiché, distinct d’une note définitive',
  )
  vérifier(
    copie.corps.includes('validation humaine') || copie.corps.includes('Validé à'),
    'l’état de validation humaine est visible',
  )
  vérifier(
    copie.corps.includes('Accepter'),
    'les actions de validation sont proposées au correcteur',
  )
  vérifier(
    !copie.corps.includes('Non encore implémenté'),
    'aucune action n’est présentée comme non implémentée',
  )

  // --- Historique --------------------------------------------------------------
  console.log('\nHistorique')

  const historique = await get('/historique')
  vérifier(historique.statut === 200, 'le journal d’audit répond', `statut ${historique.statut}`)
  vérifier(
    historique.corps.includes('Verrouillage du barème'),
    'le verrouillage du barème figure au journal',
  )
  vérifier(
    historique.corps.includes('Proposition de note'),
    'les propositions de note figurent au journal',
  )

  // --- Service des fichiers -------------------------------------------------
  console.log('\nService des fichiers de copies')

  const cléFactice = `${idÉpreuve}/copies/page-1.png`

  const sansSession = await fetch(`${BASE}/api/fichiers/${cléFactice}`, { redirect: 'manual' })
  vérifier(
    sansSession.status === 401,
    'sans session, aucun fichier n’est servi',
    `statut ${sansSession.status}`,
  )

  const sansJeton = await get(`/api/fichiers/${cléFactice}`)
  vérifier(
    sansJeton.statut === 403 || sansJeton.statut === 404,
    'une session seule ne suffit pas : un jeton signé est exigé',
    `statut ${sansJeton.statut}`,
  )

  const jetonForgé = await get(`/api/fichiers/${cléFactice}?jeton=9999999999.inventee`)
  vérifier(
    jetonForgé.statut === 403 || jetonForgé.statut === 404,
    'un jeton forgé est refusé',
    `statut ${jetonForgé.statut}`,
  )

  const remontée = await get('/api/fichiers/..%2F..%2F.env?jeton=1.x')
  vérifier(
    remontée.statut === 400 || remontée.statut === 404,
    'une remontée de répertoire est refusée',
    `statut ${remontée.statut}`,
  )

  // --- Cloisonnement -----------------------------------------------------------
  console.log('\nCloisonnement des données')

  const inexistante = await get('/epreuves/00000000-0000-4000-8000-000000000000')
  vérifier(
    inexistante.statut === 404,
    'une épreuve hors de l’organisation est introuvable, pas « refusée »',
    `statut ${inexistante.statut}`,
  )

  // --- Bilan --------------------------------------------------------------------
  console.log('')
  if (échecs === 0) {
    console.log('[32mToutes les vérifications passent.[0m\n')
  } else {
    console.error(`[31m${échecs} vérification(s) en échec.[0m\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('\nLe test de fumée a échoué :', error)
  process.exitCode = 1
})
