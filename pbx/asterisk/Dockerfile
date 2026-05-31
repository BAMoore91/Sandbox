# ============================================================================
#  Asterisk 20 (Debian Bookworm) with PJSIP realtime over PostgreSQL/ODBC.
# ============================================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        asterisk \
        asterisk-modules \
        asterisk-config \
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
