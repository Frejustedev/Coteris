/**
 * Service des fichiers de copies.
 *
 * Trois contrôles, dans cet ordre, et aucun n'est facultatif :
 *
 *   1. une session valide ;
 *   2. la permission de lire le contenu des copies — un administrateur
 *      technique ne l'a pas ;
 *   3. un jeton signé, lié à la clé et à l'organisation, non expiré.
 *
 * Le jeton seul ne suffirait pas : une URL copiée dans un courriel resterait
 * exploitable par n'importe qui pendant sa durée de vie. La session seule ne
 * suffirait pas non plus : elle n'attache l'accès à aucun fichier précis.
 */

import { NextResponse } from 'next/server'

import { can } from '@coteris/auth'
import { InvalidTokenError, StorageError, assertValidKey, verifyAccess } from '@coteris/storage'

import { getCurrentUser } from '~/lib/session'
import { storage, storageSecret } from '~/lib/storage'

export async function GET(
  requête: Request,
  { params }: { params: Promise<{ cle: string[] }> },
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return new NextResponse(null, { status: 401 })

  if (!can(user.principal, 'submissionContent', 'read')) {
    // Volontairement 404 et non 403 : confirmer l'existence d'un fichier
    // renseignerait déjà quelqu'un qui n'a pas à le savoir.
    return new NextResponse(null, { status: 404 })
  }

  const { cle } = await params
  const key = cle.map(decodeURIComponent).join('/')

  try {
    assertValidKey(key)
  } catch (error) {
    if (error instanceof StorageError) return new NextResponse(null, { status: 400 })
    throw error
  }

  // La clé est préfixée par l'organisation propriétaire. Une clé d'une autre
  // organisation ne peut donc pas être servie, même avec une session valide.
  if (!key.startsWith(`${user.principal.organizationId}/`)) {
    return new NextResponse(null, { status: 404 })
  }

  const jeton = new URL(requête.url).searchParams.get('jeton')
  if (!jeton) return new NextResponse(null, { status: 403 })

  try {
    verifyAccess(jeton, key, user.principal.organizationId, storageSecret(), Date.now())
  } catch (error) {
    if (error instanceof InvalidTokenError) return new NextResponse(null, { status: 403 })
    throw error
  }

  const objet = await storage().get(key)
  if (!objet) return new NextResponse(null, { status: 404 })

  return new NextResponse(Buffer.from(objet.bytes), {
    headers: {
      'content-type': objet.contentType,
      'content-length': String(objet.size),
      // Privé et court : une copie d'examen ne doit pas rester en cache partagé.
      'cache-control': 'private, max-age=60, must-revalidate',
      // Le fichier n'est jamais interprété comme du HTML, quel que soit son type.
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
}
