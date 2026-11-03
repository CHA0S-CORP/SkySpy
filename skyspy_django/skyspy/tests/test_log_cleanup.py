"""Regressions for warnings observed on the split production workers."""

import io
import os
import subprocess
import sys
import warnings
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings

from skyspy import task_health
from skyspy.services import notams, provider_health, weather_cache
from skyspy.tasks import aircraft_stream, geodata


def response(status=200, **kwargs):
    return httpx.Response(status, request=httpx.Request("GET", "https://weather.test/"), **kwargs)


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_weather_permanent_error_is_not_retried(status):
    with patch.object(weather_cache, "_http") as client:
        client.return_value.get.return_value = response(status)
        result = weather_cache._fetch_awc_data("metar", {})
    assert "error" in result
    assert client.return_value.get.call_count == 1
    assert "RetryError" not in result["error"]


def test_weather_transient_error_retries_and_204_is_empty():
    with patch.object(weather_cache, "_http") as client, patch.object(weather_cache._http_get_awc.retry, "sleep"):
        client.return_value.get.side_effect = [response(503), response(204)]
        assert weather_cache._fetch_awc_data("metar", {}) == []
        assert client.return_value.get.call_count == 2


def test_weather_bbox_is_normalized_at_request_boundary():
    with patch.object(weather_cache, "_http_get_awc", return_value=response(json=[])) as fetch:
        weather_cache._fetch_awc_data("pirep", {"bbox": "26.035363333,-101.833596666,34.368696666,-93.500263333"})
        assert fetch.call_args.args[1]["bbox"] == "26.03536,-101.83360,34.36870,-93.50026"


@override_settings(FEEDER_LAT=30.20203, FEEDER_LON=-97.66693, GEODATA_FETCH_RADIUS_NM=250)
def test_scheduled_weather_bbox_is_rounded():
    assert geodata._feeder_weather_bbox() == "26.03536,-101.83360,34.36870,-93.50026"


def test_weather_honors_retry_after():
    error = httpx.HTTPStatusError(
        "rate limited", request=response().request, response=response(429, headers={"Retry-After": "45"})
    )
    state = SimpleNamespace(outcome=SimpleNamespace(exception=lambda: error))
    assert weather_cache._awc_retry_wait(state) == 45


def test_failed_weather_refresh_preserves_cached_data():
    weather_cache.cache_metar("KAUS", [{"icaoId": "KAUS"}])
    with patch.object(weather_cache, "_http_get_awc", side_effect=httpx.ConnectError("offline")):
        assert "error" in weather_cache._fetch_awc_data("metar", {})
    assert weather_cache.get_cached_metar("KAUS") == [{"icaoId": "KAUS"}]


@pytest.mark.django_db
def test_pirep_queries_and_cleanup_do_not_emit_naive_datetime_warnings():
    from skyspy.models import CachedPirep

    CachedPirep.objects.create(pirep_id="timezone-check", observation_time=datetime.now(UTC))
    with warnings.catch_warnings():
        warnings.filterwarnings("error", message=".*received a naive datetime.*", category=RuntimeWarning)
        assert len(weather_cache.get_cached_pireps()) == 1
        assert weather_cache.get_pirep_stats()["pireps_last_6h"] == 1
        weather_cache.cleanup_old_pireps(retention_hours=48)


def test_provider_cooldown_expires_and_logs_recovery_once(caplog):
    now = provider_health.time.time()
    with patch.object(provider_health.time, "time", return_value=now):
        provider_health.pause_provider("test-source", 60, "HTTP 429")
        provider_health.pause_provider("test-source", 60, "HTTP 429")
        assert provider_health.cooldown_remaining("test-source") == 60
    with patch.object(provider_health.time, "time", return_value=now + 61):
        assert provider_health.cooldown_remaining("test-source") == 0
    assert caplog.text.count("test-source unavailable") == 1
    with caplog.at_level("INFO", logger="skyspy.services.provider_health"):
        provider_health.provider_recovered("test-source")
        provider_health.provider_recovered("test-source")
    assert caplog.text.count("test-source recovered") == 1


def test_notam_failure_skips_other_airports_without_blocking_tfrs():
    with patch.object(notams, "_http_post_with_retry", side_effect=httpx.ConnectError("offline")) as fetch:
        assert notams.fetch_notams_from_api(icao="KAUS") == []
        assert notams.fetch_notams_from_api(icao="KDFW") == []
        assert fetch.call_count == 1
    with patch.object(notams, "fetch_tfrs_from_api", return_value=[{"notam_id": "TFR1"}]) as tfr:
        assert notams.fetch_notams_from_api(lat=30, lon=-97) == [{"notam_id": "TFR1"}]
        tfr.assert_called_once()


class StopStream(BaseException):
    """Stop an infinite stream without being mistaken for a network failure."""


@pytest.mark.parametrize("status,headers,delay", [(403, {}, 900), (429, {"Retry-After": "45"}, 45), (429, {}, 60)])
def test_community_stream_skips_blocked_provider_and_keeps_good_source(status, headers, delay):
    blocked = MagicMock(status_code=status, headers=headers)
    good = MagicMock(status_code=200)
    good.json.return_value = {"ac": []}
    sources = [("blocked", "https://blocked/{lat}"), ("good", "https://good/{lat}")]
    with (
        patch.object(aircraft_stream, "_resolve_free_sources", return_value=sources),
        patch.object(aircraft_stream.requests, "get", side_effect=[blocked, good, good]) as fetch,
        patch.object(aircraft_stream.time, "sleep", side_effect=[None, None, StopStream]),
    ):
        with pytest.raises(StopStream):
            aircraft_stream.stream_adsblol(30, -97, 2, 250)
    assert [call.args[0] for call in fetch.call_args_list] == [
        "https://blocked/30",
        "https://good/30",
        "https://good/30",
    ]
    assert provider_health.cooldown_remaining("blocked") > delay - 10


def test_community_stream_waits_when_every_provider_is_cooling_down():
    provider_health.pause_provider("blocked", 60, "HTTP 429")
    with (
        patch.object(aircraft_stream, "_resolve_free_sources", return_value=[("blocked", "unused")]),
        patch.object(aircraft_stream.requests, "get") as fetch,
        patch.object(aircraft_stream.time, "sleep", side_effect=StopStream),
    ):
        with pytest.raises(StopStream):
            aircraft_stream.stream_adsblol(30, -97, 2, 250)
    fetch.assert_not_called()
    assert cache.get("aircraft_stream_active")


@override_settings(AIRCRAFT_STREAM_ENABLED=True, AIRCRAFT_STREAM_MODE="adsblol")
def test_community_mode_never_polls_absent_local_receiver():
    from skyspy.tasks.aircraft import poll_aircraft

    with patch("httpx.get") as fetch:
        poll_aircraft.run()
    fetch.assert_not_called()


@override_settings(AIRCRAFT_STREAM_ENABLED=True, AIRCRAFT_STREAM_MODE="adsblol")
def test_health_uses_shared_completions_and_live_stream_heartbeat():
    periodic = "skyspy.tasks.aircraft_stream.flush_stream_to_database"
    stream = "skyspy.tasks.aircraft_stream.stream_aircraft"
    polling = "skyspy.tasks.aircraft.poll_aircraft"
    task = SimpleNamespace(name=periodic, request=SimpleNamespace())
    task_health.record_task_start(task=task)
    task_health.record_task_result(task=task, state="SUCCESS")
    cache.set("aircraft_stream_active", True, 30)
    assert task_health.stale_tasks({periodic: 30, stream: 120, polling: 10}) == []
    cache.delete("aircraft_stream_active")
    assert task_health.stale_tasks({stream: 120}) == [stream]
    cache.set(f"{task_health.PREFIX}success:{periodic}", 1)
    assert task_health.stale_tasks({periodic: 30}) == [periodic]


@override_settings(AIRCRAFT_STREAM_ENABLED=False)
def test_disabled_stream_is_not_reported_stale_and_periodic_tasks_get_startup_grace():
    periodic = "skyspy.tasks.analytics.aggregate_all_stats"
    cache.set(f"{task_health.PREFIX}boot:threads", datetime.now(UTC).timestamp())
    assert task_health.stale_tasks({periodic: 180, "skyspy.tasks.aircraft_stream.stream_aircraft": 120}) == []
    cache.set(f"{task_health.PREFIX}boot:threads", 1)
    assert task_health.stale_tasks({periodic: 180}) == [periodic]


@pytest.mark.django_db
def test_bootstrap_superuser_is_idempotent_and_preserves_password():
    with patch.dict(
        "os.environ",
        {
            "DJANGO_SUPERUSER_USERNAME": "bootstrap-test",
            "DJANGO_SUPERUSER_EMAIL": "test@example.com",
            "DJANGO_SUPERUSER_PASSWORD": "first-test-password",
        },
    ):
        call_command("ensure_superuser", stdout=io.StringIO())
        with patch.dict("os.environ", {"DJANGO_SUPERUSER_PASSWORD": "new-value-not-to-apply"}):
            call_command("ensure_superuser", stdout=io.StringIO())
    user = get_user_model().objects.get(username="bootstrap-test")
    assert user.is_superuser
    assert user.check_password("first-test-password")
    assert not user.check_password("new-value-not-to-apply")


@override_settings(OPENSKY_DB_ENABLED=True)
def test_missing_opensky_cache_queues_one_download_across_workers():
    from skyspy.tasks.external_db import load_cached_databases

    with (
        patch("skyspy.services.external_db.init_databases"),
        patch("skyspy.services.external_db.get_database_stats", return_value={"opensky": {"loaded": False}}),
        patch("skyspy.tasks.external_db.load_opensky_database.delay") as download,
    ):
        load_cached_databases.run()
        load_cached_databases.run()
    download.assert_called_once()


@pytest.mark.parametrize("failed_command", ["migrate", "sync_celery_tasks", "ensure_superuser", "populate_data"])
def test_api_startup_only_tolerates_optional_population_failure(tmp_path, failed_command):
    import yaml

    compose = yaml.safe_load((Path(__file__).resolve().parents[3] / "docker-compose.yml").read_text())
    command = compose["services"]["api"]["command"]
    # Execute the real Compose startup chain with inert stand-ins for external
    # programs. No database or application server is started by this test.
    scripts = {
        "python": '#!/bin/sh\n[ "$2" != "$FAIL_COMMAND" ]\n',
        "timeout": '#!/bin/sh\nshift\nexec "$@"\n',
        "daphne": '#!/bin/sh\ntouch "$START_MARKER"\n',
    }
    for name, script in scripts.items():
        executable = tmp_path / name
        executable.write_text(script)
        executable.chmod(0o755)
    marker = tmp_path / "server-started"
    result = subprocess.run(
        command,
        shell=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{tmp_path}:/bin:/usr/bin",
            "FAIL_COMMAND": failed_command,
            "START_MARKER": str(marker),
        },
        timeout=5,
    )
    assert marker.exists() == (failed_command == "populate_data")
    assert (result.returncode == 0) == (failed_command == "populate_data")


def test_gevent_cli_bootstrap_patches_once_without_application_repatching():
    code = """
import sys
sys.argv = ['celery', 'worker', '--pool=gevent']
from celery import maybe_patch_concurrency
maybe_patch_concurrency()
import skyspy.celery
from gevent import monkey
assert monkey.is_module_patched('socket')
assert monkey.is_module_patched('ssl')
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=15,
        env={**os.environ, "CELERY_POOL": "gevent"},
    )
    assert result.returncode == 0, result.stderr
    assert "MonkeyPatchWarning" not in result.stderr
