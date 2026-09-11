"""Task 0 -- API token: X-FilePlus-Token gates every route except /health.

When FILEPLUS_API_TOKEN is unset (dev default, most tests), the gate is a
no-op -- every other test file in this suite relies on that. When it's set,
a request without the header (or with the wrong one) is 401; the right one
is 200. /health is always reachable and reports whether auth is required.
"""
import pytest
from fastapi.testclient import TestClient

import backend.config as _config


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_health_reports_auth_false_when_token_unset(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["auth"] is False


def test_unauthenticated_routes_work_when_token_unset(client):
    assert client.get("/files").status_code == 200


def test_health_reports_auth_true_when_token_set(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["auth"] is True


def test_missing_header_is_401_when_token_set(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/files")
    assert r.status_code == 401
    assert "token" in r.json()["detail"].lower()


def test_wrong_header_is_401_when_token_set(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/files", headers={"X-FilePlus-Token": "wrong"})
    assert r.status_code == 401


def test_correct_header_is_200_when_token_set(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/files", headers={"X-FilePlus-Token": "t"})
    assert r.status_code == 200


def test_health_never_requires_the_header(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/health")
    assert r.status_code == 200


def test_post_route_also_gated(client, monkeypatch, sandbox):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"})
    assert r.status_code == 401
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"},
                     headers={"X-FilePlus-Token": "t"})
    assert r.status_code == 200
