"""
Database configuration and session management.

Optimized for Raspberry Pi with limited resources:
- Smaller connection pool to reduce memory usage
- Shorter timeouts to fail fast under load
- Connection recycling to prevent stale connections
"""
import asyncio
import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


def get_async_database_url(url: str) -> str:
    """Convert sync database URL to async version."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


settings = get_settings()
async_url = get_async_database_url(settings.database_url)

# SQLite doesn't support pool_size/max_overflow, only use them for PostgreSQL
if async_url.startswith("sqlite"):
    engine = create_async_engine(
        async_url,
        echo=False,
    )
else:
    # Optimized for Raspberry Pi:
    # - pool_size=3: Small base pool to reduce memory footprint
    # - max_overflow=7: Allow up to 10 total connections under burst load
    # - pool_timeout=10: Fail fast if pool exhausted (avoid request pile-up)
    # - pool_recycle=180: Recycle connections every 3 min (prevent stale connections)
    # - pool_pre_ping=True: Verify connections before use
    # - connect_args timeout: 5s connection timeout (fail fast on DB issues)
    engine = create_async_engine(
        async_url,
        echo=False,
        pool_pre_ping=True,
        pool_recycle=180,
        pool_size=3,
        max_overflow=7,
        pool_timeout=10,
        connect_args={
            "timeout": 5,
            "command_timeout": 30,
        },
    )

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    """Close database connections."""
    await engine.dispose()


async def db_execute_safe(db: AsyncSession, query, default=None):
    """
    Execute a database query with graceful error handling.

    Returns the default value on timeout or connection errors instead of
    raising exceptions. This prevents 503 errors from cascading during
    high load on resource-constrained systems like Raspberry Pi.
    """
    try:
        return await asyncio.wait_for(db.execute(query), timeout=10.0)
    except asyncio.TimeoutError:
        logger.warning("Database query timed out")
        return default
    except SQLAlchemyError as e:
        logger.warning(f"Database error: {e}")
        return default
    except Exception as e:
        logger.error(f"Unexpected database error: {e}")
        return default
