"""Runtime configuration sourced from environment variables (.env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # --- Postgres ---
    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "openpbx"
    postgres_user: str = "openpbx"
    postgres_password: str = "openpbx"

    # --- Auth ---
    jwt_secret: str = "dev-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 720

    # --- Bootstrap super-admin ---
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    # --- Asterisk control plane ---
    asterisk_ari_url: str = "http://asterisk:8088/ari"
    ari_username: str = "openpbx-ari"
    ari_password: str = "openpbx-ari"
    asterisk_ami_host: str = "asterisk"
    asterisk_ami_port: int = 5038
    ami_username: str = "openpbx-ami"
    ami_password: str = "openpbx-ami"

    # --- Defaults applied when provisioning new tenants/extensions ---
    public_hostname: str = "pbx.example.com"

    # --- Custom audio prompts (shared volume read by Asterisk) ---
    # Files are written to <sounds_dir>/<slug>/<name>.wav and referenced in the
    # dialplan as custom/<slug>/<name>. Asterisk mounts the same volume at
    # /var/lib/asterisk/sounds/custom, so sounds_dir maps there.
    sounds_dir: str = "/sounds"
    max_prompt_bytes: int = 15 * 1024 * 1024

    # --- Call recordings (shared volume written by Asterisk MixMonitor) ---
    # Asterisk writes to /var/spool/asterisk/monitor/<slug>/<date>/<id>.wav;
    # cdr.recording / recordings.path store the path relative to this dir.
    recordings_dir: str = "/recordings"

    # --- Data retention sweeper ---
    # Set to 0 to disable the in-process scheduler (e.g. if you run the purge
    # from an external cron hitting the admin "run now" endpoint instead).
    retention_interval_hours: int = 24
    retention_enabled: bool = True

    # --- Notifications (missed-call / voicemail email + SMS) ---
    # A background worker drains the notifications outbox and delivers via
    # SMTP and/or Twilio SMS. Disable to pause delivery (events still queue).
    notifications_enabled: bool = True
    notify_poll_seconds: int = 15
    notify_max_attempts: int = 5
    # SMTP (email). If smtp_host is empty, email delivery is skipped.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_from: str = "OpenPBX <noreply@example.com>"
    # Twilio REST (SMS). If these are empty, SMS delivery is skipped.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_sms_from: str = ""          # E.164 sender, or a Messaging Service SID
    # Public base URL used to build links in notifications (voicemail/portal).
    public_base_url: str = ""

    @property
    def dsn(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
