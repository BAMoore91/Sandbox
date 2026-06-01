# ============================================================================
#  Asterisk (PJSIP realtime over PostgreSQL/ODBC).
#  Base: Ubuntu 22.04 (jammy) — ships Asterisk 18 in 'universe' with the
#  asterisk/asterisk-modules/asterisk-config packages (incl. res_fax_spandsp).
#  NOTE: Debian 12 (bookworm) dropped Asterisk from main, so debian-slim has no
#  install candidate — that caused "Package 'asterisk' has no installation
#  candidate". Ubuntu keeps the same package names + ODBC driver path.
# ============================================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Asterisk lives in 'universe'; ensure it's enabled before installing.
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common \
    && add-apt-repository -y universe \
    && apt-get update && apt-get install -y --no-install-recommends \
        asterisk \
        asterisk-modules \
        asterisk-config \
        libtiff-tools \
        odbc-postgresql \
        unixodbc \
        gettext-base \
        openssl \
        ca-certificates \
        curl \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# Default sound prompts + MoH dirs
RUN mkdir -p /var/lib/asterisk/moh /var/spool/asterisk/voicemail \
    && chown -R asterisk:asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk

# Helper scripts (externnotify hook, etc.)
COPY scripts/ /etc/asterisk/scripts/
RUN chmod +x /etc/asterisk/scripts/*.sh

# Templates are rendered at runtime by the entrypoint.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5060/udp 5060/tcp 5061/tcp 8088/tcp 8089/tcp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["asterisk", "-fvvv"]
