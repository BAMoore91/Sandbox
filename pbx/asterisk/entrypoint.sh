#!/usr/bin/env bash
# ============================================================================
#  Asterisk entrypoint
#  1. render *.tmpl config from env -> /etc/asterisk
#  2. copy plain configs verbatim (dialplan must NOT be passed through envsubst)
#  3. install ODBC driver/DSN files
#  4. generate a self-signed TLS cert if none is mounted
#  5. wait for PostgreSQL, then exec Asterisk
# ============================================================================
set -euo pipefail

TPL=/etc/asterisk-templates
DST=/etc/asterisk

# Variables allowed in templates. Restricting the list means a stray "$" in a
# config can never be clobbered, and dialplan ${...} is never touched (those
# files have no .tmpl suffix so they're copied verbatim).
TEMPLATE_VARS='${PUBLIC_HOSTNAME} ${PUBLIC_IP} ${LOCAL_NET}
  ${POSTGRES_HOST} ${POSTGRES_PORT} ${POSTGRES_DB} ${POSTGRES_USER} ${POSTGRES_PASSWORD}
  ${ARI_USERNAME} ${ARI_PASSWORD} ${AMI_USERNAME} ${AMI_PASSWORD}
  ${RTP_START} ${RTP_END} ${TLS_CERT_FILE} ${TLS_KEY_FILE}'

echo "[entrypoint] rendering configuration..."
mkdir -p "$DST"
for f in "$TPL"/*; do
  name="$(basename "$f")"
  case "$name" in
    odbc.ini.tmpl)      envsubst "$TEMPLATE_VARS" < "$f" > /etc/odbc.ini ;;
    odbcinst.ini)       cp "$f" /etc/odbcinst.ini ;;
    *.tmpl)             envsubst "$TEMPLATE_VARS" < "$f" > "$DST/${name%.tmpl}" ;;
    *)                  cp "$f" "$DST/$name" ;;
  esac
done

# ---- Dialplan include dir (generated per-tenant BLF hint contexts) --------
# Ensure it exists with a placeholder so #include "dialplan/tenant-*.conf"
# never errors on a fresh volume.
mkdir -p /etc/asterisk/dialplan
[[ -f /etc/asterisk/dialplan/.keep ]] || echo "; tenant dialplan files land here" \
    > /etc/asterisk/dialplan/.keep
chown -R asterisk:asterisk /etc/asterisk/dialplan || true

# ---- TLS cert (self-signed fallback) --------------------------------------
mkdir -p /etc/asterisk/keys
if [[ ! -f "${TLS_CERT_FILE}" || ! -f "${TLS_KEY_FILE}" ]]; then
  echo "[entrypoint] generating self-signed TLS cert for ${PUBLIC_HOSTNAME}"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "${TLS_KEY_FILE}" -out "${TLS_CERT_FILE}" \
    -subj "/CN=${PUBLIC_HOSTNAME}" \
    -addext "subjectAltName=DNS:${PUBLIC_HOSTNAME}" 2>/dev/null
fi
chown -R asterisk:asterisk /etc/asterisk/keys

# ---- Wait for PostgreSQL ---------------------------------------------------
echo "[entrypoint] waiting for postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
for i in $(seq 1 60); do
  if (echo > "/dev/tcp/${POSTGRES_HOST}/${POSTGRES_PORT}") >/dev/null 2>&1; then
    echo "[entrypoint] postgres is up"; break
  fi
  sleep 2
done

chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk || true

echo "[entrypoint] starting: $*"
exec "$@"
