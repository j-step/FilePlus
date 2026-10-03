"""API token: X-FilePlus-Token gates every route except /health.

Under test the token is cleared by the `sandbox` fixture (and lifespan's
ensure_api_token stubbed out with it) so the gate is a no-op -- every other
test file in this suite relies on that. When it's set, a request without the
header (or with the wrong one) is 401; the right one is 200. /health is
always reachable and reports whether auth is required.

Pass 2 (finding #45): a *real* backend never runs unauthenticated -- with
FILEPLUS_API_TOKEN unset, lifespan mints and persists one -- and CORS allows
only the Electron renderer's file:// origin ("null"), never a web page's.
"""
import pytest
from fastapi.testclient import TestClient

import backend.config as _config

# Captured at import time, before the `sandbox` fixture stubs the attribute
# out for every other test in the suite.
_REAL_ENSURE_API_TOKEN = _config.ensure_api_token


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


# ---------------------------------------------------------------------------
# Fix round -- CORSMiddleware must be outermost so a 401 (returned by our
# middleware without calling call_next) still carries Access-Control-Allow-
# Origin; otherwise Electron's fetch() sees a CORS failure instead of a 401.
# ---------------------------------------------------------------------------

def test_401_response_still_carries_cors_header(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/files", headers={"Origin": "null"})
    assert r.status_code == 401
    assert r.headers.get("access-control-allow-origin") == "null"


def test_200_response_also_carries_cors_header(client, monkeypatch):
    # Same-shape check on the success path, so a future middleware reorder
    # that broke only the happy path wouldn't slip through unnoticed.
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    r = client.get("/files", headers={"Origin": "null", "X-FilePlus-Token": "t"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "null"


# ---------------------------------------------------------------------------
# Fix round -- compare_digest on UTF-8 bytes: a non-ASCII header value must
# 401, not crash the middleware with an unhandled 500.
# ---------------------------------------------------------------------------

def test_non_ascii_token_header_is_401_not_500(client, monkeypatch):
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    # httpx's TestClient rejects a non-ASCII *str* header value client-side
    # (it insists on ascii-encoding str values before sending); passing raw
    # UTF-8 bytes bypasses that client-side check and actually exercises the
    # server's decoding + compare_digest path, which is what this guards.
    r = client.get("/files", headers={"X-FilePlus-Token": "tökén-ñ".encode("utf-8")})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Pass 2, finding #45 -- no unauthenticated default, no cross-origin access.
# ---------------------------------------------------------------------------

def test_ensure_api_token_mints_and_persists_when_unset(sandbox, tmp_path, monkeypatch):
    token_file = tmp_path / "minted" / ".fileplus-token"
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "")
    monkeypatch.setattr(_config, "FILEPLUS_TOKEN_FILE", token_file)
    minted = _REAL_ENSURE_API_TOKEN()
    assert len(minted) == 64 and all(c in "0123456789abcdef" for c in minted)
    assert token_file.read_text(encoding="utf-8").strip() == minted
    # Reused across restarts, so an already-running renderer's token stays valid.
    assert _REAL_ENSURE_API_TOKEN() == minted


def test_ensure_api_token_prefers_the_configured_value(sandbox, tmp_path, monkeypatch):
    token_file = tmp_path / ".fileplus-token"
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "configured")
    monkeypatch.setattr(_config, "FILEPLUS_TOKEN_FILE", token_file)
    assert _REAL_ENSURE_API_TOKEN() == "configured"
    assert not token_file.exists()


def test_startup_mints_a_token_and_requires_it(sandbox, db, tmp_path, monkeypatch):
    """With nothing configured, the running app still 401s an unauthenticated call."""
    from backend.api import app
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "")
    monkeypatch.setattr(_config, "FILEPLUS_TOKEN_FILE", tmp_path / "startup" / ".fileplus-token")
    monkeypatch.setattr(_config, "ensure_api_token", _REAL_ENSURE_API_TOKEN)
    with TestClient(app) as c:
        minted = _config.FILEPLUS_API_TOKEN
        assert len(minted) == 64
        assert c.get("/health").json()["auth"] is True
        assert c.get("/files").status_code == 401
        assert c.get("/files", headers={"X-FilePlus-Token": minted}).status_code == 200


def test_cross_origin_preflight_is_not_allowed(client):
    """A web page's preflight for a destructive route gets no ACAO header."""
    r = client.options("/fs/trash", headers={
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert r.headers.get("access-control-allow-origin") is None


def test_cross_origin_post_response_is_not_readable(client, sandbox):
    """Even if a page sends the request, the response carries no ACAO for it."""
    victim = sandbox / "payslip.pdf"
    victim.write_text("x", encoding="utf-8")
    r = client.post("/fs/trash", json={"paths": [str(victim)]},
                    headers={"Origin": "https://evil.example"})
    assert r.headers.get("access-control-allow-origin") is None


def test_electron_file_origin_preflight_is_allowed(client):
    r = client.options("/fs/trash", headers={
        "Origin": "null",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "null"


def test_shell_icon_routes_are_token_gated(client, monkeypatch):
    """Pass 2 (icon design step 3): the shell-icon routes sit behind the same
    X-FilePlus-Token gate as every other non-/health route."""
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    assert client.get("/shell/icon", params={"path": r"C:\Windows", "px": 16}).status_code == 401
    assert client.post("/shell/icons", json={"items": []}).status_code == 401
    assert client.post("/shell/icons", json={"items": []}, headers={"X-FilePlus-Token": "t"}).status_code == 200


def test_stage_2d_delete_and_merge_routes_are_token_gated(client, monkeypatch):
    """Stage 2D Task 12a/12b added DELETE /recent, DELETE /shell/icons/cache
    and POST /config/merge: each sits behind the same X-FilePlus-Token gate."""
    monkeypatch.setattr(_config, "FILEPLUS_API_TOKEN", "t")
    ok = {"X-FilePlus-Token": "t"}
    assert client.delete("/recent").status_code == 401
    assert client.delete("/recent", headers=ok).status_code == 200
    assert client.delete("/shell/icons/cache").status_code == 401
    assert client.delete("/shell/icons/cache", headers=ok).status_code == 200
    body = {"key": "ui.folder_views", "value": {}}
    assert client.post("/config/merge", json=body).status_code == 401
    assert client.post("/config/merge", json=body, headers=ok).status_code == 200
