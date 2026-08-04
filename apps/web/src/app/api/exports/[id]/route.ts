/**
 * Téléchargement d'un export.
 *
 * Contrôles : session valide, permission `export.read`, et export appartenant à
 * l'organisation de la session. Un export contient des notes nominatives ou
 * pseudonymisées — il ne circule pas librement.
 */

import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { can } from '@coteris/auth'
import { contentTypeForFileName } from '@coteris/exports'

import { db, schema } from '~/lib/db'
import { getCurrentUser } from '~/lib/session'
import { storage } from '~/lib/storage'

export async function GET(
  _requête: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) return new NextResponse(null, { status: 401 })

  if (!can(user.principal, 'export', 'read')) {
    return new NextResponse(null, { status: 404 })
  }

  const { id } = await params

  const [ligne] = await db
    .select({
      fileKey: schema.exportJobs.fileKey,
      fileName: schema.exportJobs.fileName,
      expiresAt: schema.exportJobs.expiresAt,
    })
    .from(schema.exportJobs)
    .where(
      and(
        eq(schema.exportJobs.id, id),
        eq(schema.exportJobs.organizationId, user.principal.organizationId),
      ),
    )
    .limit(1)

  if (!ligne?.fileKey) return new NextResponse(null, { status: 404 })

  if (ligne.expiresAt && ligne.expiresAt.getTime() < Date.now()) {
    return new NextResponse('Cet export a expiré. Relancez-en un nouveau.', { status: 410 })
  }

  const objet = await storage().get(ligne.fileKey)
  if (!objet) return new NextResponse(null, { status: 404 })

  // Le type est DÉDUIT du nom enregistré, jamais figé. Servir tout en text/csv
  // avec `nosniff` interdit au navigateur tout rattrapage : un corrigé PDF
  // s'ouvrirait dans un tableur, un classeur en texte brut.
  const nomFichier = ligne.fileName ?? 'export.csv'

  return new NextResponse(Buffer.from(objet.bytes), {
    headers: {
      'content-type': contentTypeForFileName(nomFichier),
      'content-length': String(objet.size),
      'content-disposition': `attachment; filename="${nomFichier}"`,
      // Jamais en cache partagé : le fichier contient des notes.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
