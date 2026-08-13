from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    secret_key: str = "change-me"
    session_max_age_seconds: int = 28800
    database_url: str = "postgresql+psycopg2://inventory:inventory@db:5432/inventory"
    frontend_url: str = "http://localhost:3000"
    cors_allow_origins: str = "http://localhost:3000"

    o365_tenant_id: Optional[str] = None
    o365_client_id: Optional[str] = None
    o365_client_secret: Optional[str] = None
    # Certificate credential (preferred when tenant blocks client secrets)
    o365_client_cert_path: Optional[str] = None      # path to PEM private key file
    o365_client_cert_thumbprint: Optional[str] = None  # SHA-1 thumbprint from Azure
    o365_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    o365_admin_users: str = ""
    o365_allowed_users: str = ""

    helpdesk_email: str = "helpdesk@dayair.org"
    helpdesk_poll_interval: int = 60  # seconds
    # Only process emails received on or after this date (YYYY-MM-DD).
    # Set this to your go-live date to ignore all historical email.
    helpdesk_start_date: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @property
    def admin_users_list(self) -> list[str]:
        return [u.strip().lower() for u in self.o365_admin_users.split(",") if u.strip()]

    @property
    def allowed_users_list(self) -> list[str]:
        return [u.strip().lower() for u in self.o365_allowed_users.split(",") if u.strip()]


settings = Settings()
