#!/usr/bin/env bash
# ============================================================================
#  externnotify hook — enqueue a "voicemail" notification when a message is
#  saved. Asterisk invokes:
#     vm-notify.sh <context> <mailbox> <newcount> <oldcount> [<caller>]
#  context == tenant slug, mailbox == extension. We only enqueue when the new
#  message count went up (i.e. a message was actually left, not on MWI churn).
#  The row is inserted via the same NOTIFY fan-out SQL the dialplan uses, by
#  calling the API's internal enqueue endpoint over the docker network.
# ============================================================================
set -euo pipefail

CONTEXT="${1:-}"      # tenant slug
MAILBOX="${2:-}"      # extension
NEWCOUNT="${3:-0}"
OLDCOUNT="${4:-0}"
CALLER="${5:-}"

# Only notify when the mailbox gained a message.
if [ "${NEWCOUNT}" -le "${OLDCOUNT}" ]; then
  exit 0
fi

# Hand off to the API's internal enqueue endpoint (no auth; bound to the
# private docker network only — never exposed via the public proxy).
API_URL="${OPENPBX_API_URL:-http://api:8000}/api/internal/notify"

curl -fsS -m 5 -X POST "${API_URL}" \
  -H 'Content-Type: application/json' \
  -d "{\"slug\":\"${CONTEXT}\",\"extension\":\"${MAILBOX}\",\"event\":\"voicemail\",\"caller\":\"${CALLER}\"}" \
  >/dev/null 2>&1 || true

exit 0
