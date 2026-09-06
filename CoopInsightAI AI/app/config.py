"""Runtime configuration, read from the environment (.env in development)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # The AI service reads the backend's database directly. This is forced by the
    # existing contract: the Node layer passes only a cooperativeId, never the
    # rows, so the service has to fetch its own features.
    database_url: str = "postgresql://postgres:password@localhost:5432/coopinsight_ai"

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    # Fitted parameters and evaluation metrics are persisted here so that
    # /model-performance reports what was actually fitted rather than a guess.
    model_store: Path = Path("./model_store")

    service_name: str = "CoopInsight AI Service"
    version: str = "0.1.0"

    # ── Analysis thresholds ────────────────────────────────────────────────
    # Below this many observations, a fitted detector cannot be trusted and the
    # analytics fall back to robust statistics that behave sensibly on tiny
    # samples. See docs in app/analytics/anomalies.py.
    min_observations_for_model: int = 30

    # Modified z-score above which a point is called an outlier. 3.5 is the
    # conventional cut-off for the MAD-based statistic (Iglewicz & Hoaglin).
    outlier_threshold: float = 3.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
