'use client'

/**
 * Éditeur de zones de réponse.
 *
 * Les coordonnées sont **relatives à la page** (0 à 1), jamais en pixels : elles
 * restent donc valides quelle que soit la taille d'affichage, et si l'image est
 * un jour remplacée par sa version améliorée.
 *
 * Piloté à la souris et **au clavier** : les flèches déplacent la zone
 * sélectionnée, majuscule + flèches la redimensionne. Une zone qu'on ne peut
 * placer qu'à la souris est inaccessible à une partie des utilisateurs.
 */

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState, useTransition, type PointerEvent } from 'react'

import { enregistrerZones } from './actions'

interface Zone {
  id: string
  number: string
  prompt: string
  x: number
  y: number
  width: number
  height: number
  origin: string
}

type Poignée = 'deplacer' | 'redimensionner'

const PAS = 0.005
const MIN = 0.01

const COULEURS = [
  'border-marine-600 bg-marine-600/10',
  'border-petrole-600 bg-petrole-600/10',
  'border-or-700 bg-or-500/10',
  'border-vert-fg bg-vert-bg/50',
  'border-rouge-fg bg-rouge-bg/50',
]

export function ÉditeurZones({
  submissionId,
  imageUrl,
  zones: initiales,
  peutCorriger,
}: {
  submissionId: string
  imageUrl: string | null
  zones: Zone[]
  peutCorriger: boolean
}) {
  const router = useRouter()
  const cadre = useRef<HTMLDivElement>(null)
  const [zones, setZones] = useState(initiales)
  const [sélection, setSélection] = useState<string | null>(initiales[0]?.id ?? null)
  const [enCours, démarrer] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)
  const glisse = useRef<{ id: string; poignée: Poignée; dx: number; dy: number } | null>(null)

  const modifiée = zones.some((z) => {
    const départ = initiales.find((i) => i.id === z.id)
    if (!départ) return false
    return (
      Math.abs(z.x - départ.x) > 1e-6 ||
      Math.abs(z.y - départ.y) > 1e-6 ||
      Math.abs(z.width - départ.width) > 1e-6 ||
      Math.abs(z.height - départ.height) > 1e-6
    )
  })

  const positionRelative = useCallback((event: PointerEvent) => {
    const rect = cadre.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }, [])

  function commencer(event: PointerEvent, id: string, poignée: Poignée) {
    if (!peutCorriger) return
    event.preventDefault()
    event.stopPropagation()
    const zone = zones.find((z) => z.id === id)
    if (!zone) return

    const p = positionRelative(event)
    glisse.current = { id, poignée, dx: p.x - zone.x, dy: p.y - zone.y }
    setSélection(id)
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  function déplacer(event: PointerEvent) {
    const état = glisse.current
    if (!état) return

    const p = positionRelative(event)
    setZones((courantes) =>
      courantes.map((z) => {
        if (z.id !== état.id) return z

        if (état.poignée === 'deplacer') {
          return {
            ...z,
            // Le serrage empêche de sortir de la page : la contrainte est aussi
            // vérifiée côté serveur, mais l'appliquer ici évite à l'utilisateur
            // de dessiner une zone qui sera refusée.
            x: serrer(p.x - état.dx, 0, 1 - z.width),
            y: serrer(p.y - état.dy, 0, 1 - z.height),
          }
        }

        return {
          ...z,
          width: serrer(p.x - z.x, MIN, 1 - z.x),
          height: serrer(p.y - z.y, MIN, 1 - z.y),
        }
      }),
    )
  }

  function terminer() {
    glisse.current = null
  }

  function auClavier(event: React.KeyboardEvent, id: string) {
    if (!peutCorriger) return
    const touches = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    if (!touches.includes(event.key)) return
    event.preventDefault()

    const dx = event.key === 'ArrowLeft' ? -PAS : event.key === 'ArrowRight' ? PAS : 0
    const dy = event.key === 'ArrowUp' ? -PAS : event.key === 'ArrowDown' ? PAS : 0

    setZones((courantes) =>
      courantes.map((z) => {
        if (z.id !== id) return z
        if (event.shiftKey) {
          return {
            ...z,
            width: serrer(z.width + dx, MIN, 1 - z.x),
            height: serrer(z.height + dy, MIN, 1 - z.y),
          }
        }
        return {
          ...z,
          x: serrer(z.x + dx, 0, 1 - z.width),
          y: serrer(z.y + dy, 0, 1 - z.height),
        }
      }),
    )
  }

  function enregistrer() {
    setMessage(null)
    démarrer(async () => {
      const résultat = await enregistrerZones({
        submissionId,
        zones: zones.map((z) => ({
          answerRegionId: z.id,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
        })),
      })

      setMessage({
        ok: résultat.ok,
        texte: résultat.ok
          ? (résultat.message ?? 'Enregistré.')
          : [résultat.message, ...(résultat.problèmes ?? [])].filter(Boolean).join(' '),
      })

      if (résultat.ok) router.refresh()
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div
        ref={cadre}
        onPointerMove={déplacer}
        onPointerUp={terminer}
        onPointerCancel={terminer}
        className="relative aspect-[1/1.414] w-full overflow-hidden rounded-lg border border-marine-100 bg-marine-50/40 select-none"
      >
        {imageUrl ? (
          /*
            Balise <img> et non next/image : l'optimiseur mettrait en cache une
            copie d'examen sur le disque du serveur, hors de la couche de stockage
            qui contrôle les accès.
          */
          <img
            src={imageUrl}
            alt="Page de la copie"
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-anthracite-400">
            Aucune image associée à cette page. Les copies de démonstration sont simulées ;
            les zones restent déplaçables et leurs coordonnées enregistrées.
          </p>
        )}

        {zones.map((z, i) => {
          const actif = sélection === z.id
          return (
            <div
              key={z.id}
              role="button"
              tabIndex={0}
              aria-label={`Zone de la question ${z.number}`}
              onPointerDown={(e) => commencer(e, z.id, 'deplacer')}
              onKeyDown={(e) => auClavier(e, z.id)}
              onFocus={() => setSélection(z.id)}
              style={{
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.width * 100}%`,
                height: `${z.height * 100}%`,
              }}
              className={`absolute border-2 ${COULEURS[i % COULEURS.length]} ${
                actif ? 'ring-2 ring-petrole-600 ring-offset-1' : ''
              } ${peutCorriger ? 'cursor-move' : 'cursor-default'}`}
            >
              <span className="tabulaire absolute -top-px left-0 bg-white/90 px-1 text-[10px] font-medium text-anthracite-800">
                Q{z.number}
              </span>

              {peutCorriger && (
                <span
                  onPointerDown={(e) => commencer(e, z.id, 'redimensionner')}
                  className="absolute -right-1 -bottom-1 size-3 cursor-nwse-resize rounded-sm border border-white bg-marine-700"
                  aria-hidden
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        <ul className="space-y-1.5">
          {zones.map((z) => (
            <li key={z.id}>
              <button
                type="button"
                onClick={() => setSélection(z.id)}
                aria-current={sélection === z.id}
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  sélection === z.id
                    ? 'border-petrole-600 bg-petrole-50'
                    : 'border-marine-100 bg-white hover:border-petrole-300'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabulaire text-sm font-medium">Q{z.number}</span>
                  <span
                    className={`text-[10px] ${
                      z.origin === 'manual' ? 'text-vert-fg' : 'text-orange-fg'
                    }`}
                  >
                    {z.origin === 'manual' ? 'tracée à la main' : 'hypothèse à vérifier'}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-anthracite-600">{z.prompt}</p>
                <p className="tabulaire mt-1 text-[10px] text-anthracite-400">
                  {(z.x * 100).toFixed(0)} · {(z.y * 100).toFixed(0)} —{' '}
                  {(z.width * 100).toFixed(0)} × {(z.height * 100).toFixed(0)}
                </p>
              </button>
            </li>
          ))}
        </ul>

        {message && (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 text-sm ${
              message.ok
                ? 'border-vert-bd bg-vert-bg text-vert-fg'
                : 'border-rouge-bd bg-rouge-bg text-rouge-fg'
            }`}
          >
            {message.texte}
          </p>
        )}

        {peutCorriger ? (
          <>
            <button
              type="button"
              disabled={enCours}
              onClick={enregistrer}
              className="w-full rounded-md bg-marine-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-marine-600 disabled:opacity-40"
            >
              {enCours
                ? 'Enregistrement…'
                : modifiée
                  ? 'Enregistrer et relancer les analyses'
                  : 'Confirmer la segmentation'}
            </button>
            <p className="text-xs text-anthracite-400">
              Sélectionnez une zone puis utilisez les flèches pour la déplacer, majuscule +
              flèches pour la redimensionner. Seules les zones réellement déplacées voient
              leur analyse relancée.
            </p>
          </>
        ) : (
          <p className="rounded-md border border-marine-100 bg-marine-50/40 px-3 py-2 text-sm text-anthracite-600">
            Votre rôle ne permet pas de corriger la segmentation.
          </p>
        )}
      </div>
    </div>
  )
}

function serrer(valeur: number, min: number, max: number): number {
  return Math.min(Math.max(valeur, min), Math.max(min, max))
}
