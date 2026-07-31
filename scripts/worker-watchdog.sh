#!/bin/sh
#
# Surveillance du worker Coteris, pour hébergement mutualisé.
#
# Passenger maintient l'application web en vie, pas le worker. Cette tâche cron
# vérifie chaque minute qu'il tourne et le relance sinon. C'est une béquille ;
# elle est assumée et documentée dans docs/deployment.md.
#
#   * * * * * /chemin/vers/coteris/scripts/worker-watchdog.sh
#
# Le verrou `flock` est indispensable : sans lui, deux exécutions concurrentes
# de cron lanceraient deux workers, qui se disputeraient les mêmes jobs.

set -eu

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
VERROU="$RACINE/.data/worker.lock"
JOURNAL="$RACINE/.data/worker.log"

mkdir -p "$RACINE/.data"

# Un worker déjà vivant : rien à faire.
if pgrep -f "coteris/worker" >/dev/null 2>&1; then
  exit 0
fi

# `flock -n` échoue immédiatement si le verrou est pris, plutôt que d'attendre :
# la minute suivante réessaiera de toute façon.
exec flock -n "$VERROU" sh -c "
  cd '$RACINE'
  echo \"[\$(date -Iseconds)] démarrage du worker\" >> '$JOURNAL'
  exec pnpm --filter @coteris/worker start >> '$JOURNAL' 2>&1
"
