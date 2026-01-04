"""
Database configuration and session management.

Optimized for Raspberry Pi 5 with PgBouncer:
- Increased connection limits (RPi5 has sufficient RAM/CPU)
- Disables prepared statements (Required for PgBouncer Transaction Mode)
- Relies on PgBouncer for backend pooling while maintaining a robust local pool
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
    # Optimized for RPi 5 + PgBouncer:
    # - pool_size=20: RPi5 can easily handle this concurrency. 
    #                 We need enough local slots to feed PgBouncer.
    # - max_overflow=20: Allow bursts up to 40 total connections locally.
    # - statement_cache_size=0: CRITICAL for PgBouncer transaction pooling. 
    #                           Prevents "prepared statement X does not exist" errors.
    # - pool_pre_ping=True: Vital to detect if PgBouncer closed a connection.
    engine = create_async_engine(
        async_url,
        echo=False,
        pool_pre_ping=True,
        pool_recycle=300,  # Recycle every 5 min
        pool_size=20,      # Increased from 3 for RPi5
        max_overflow=20,   # Increased from 7
        pool_timeout=30,   # Give PgBouncer time to allocate slots
        connect_args={
            "timeout": 10,
            "command_timeout": 60,
            # "server_settings": {
            #     "jit": "off",  # Optimization: Disable JIT for short OLTP queries
            # },
            # key fix for pgbouncer compatibility with asyncpg
            "statement_cache_size": 0,
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
    raising exceptions.
    """
    try:
        # Increased timeout for complex queries on RPi
        return await asyncio.wait_for(db.execute(query), timeout=15.0)
    except asyncio.TimeoutError:
        logger.warning("Database query timed out")
        return default
    except SQLAlchemyError as e:
        logger.warning(f"Database error: {e}")
        return default
    except Exception as e:
        logger.error(f"Unexpected database error: {e}")
        return default