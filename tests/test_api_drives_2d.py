"""Stage 2D §8: /drives carries kind + fs and includes removable/network/cdrom."""
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox):
    from backend.api import app
    return TestClient(app)


def _parts():
    return [NS(device="C:\\", mountpoint="C:\\", fstype="NTFS", opts="rw,fixed"),
            NS(device="E:\\", mountpoint="E:\\", fstype="FAT32", opts="rw,removable"),
            NS(device="F:\\", mountpoint="F:\\", fstype="", opts="cdrom"),
            NS(device="G:\\", mountpoint="G:\\", fstype="CDFS", opts="ro,cdrom"),
            NS(device="Z:\\", mountpoint="Z:\\", fstype="NTFS", opts="rw,remote")]


def test_drives_kinds_and_no_media_skipped(client, monkeypatch):
    from backend import api as api_module
    monkeypatch.setattr(api_module.psutil, "disk_partitions", lambda all=False: _parts())

    def usage(p):
        if p.startswith("F"):
            raise OSError("no media")
        return NS(total=100, used=40, free=60, percent=40.0)

    monkeypatch.setattr(api_module.psutil, "disk_usage", usage)
    items = client.get("/drives").json()
    kinds = {d["letter"]: d["kind"] for d in items}
    assert kinds == {"C:": "fixed", "E:": "removable", "G:": "cdrom", "Z:": "network"}
    fs = {d["letter"]: d["fs"] for d in items}
    assert fs == {"C:": "NTFS", "E:": "FAT32", "G:": "CDFS", "Z:": "NTFS"}


def test_drives_asks_psutil_for_all_partitions(client, monkeypatch):
    from backend import api as api_module
    seen = {}

    def parts(all=False):
        seen["all"] = all
        return []

    monkeypatch.setattr(api_module.psutil, "disk_partitions", parts)
    assert client.get("/drives").json() == []
    assert seen["all"] is True


def test_drives_permission_error_skipped(client, monkeypatch):
    from backend import api as api_module
    monkeypatch.setattr(api_module.psutil, "disk_partitions", lambda all=False: _parts()[:2])

    def usage(p):
        if p.startswith("E"):
            raise PermissionError("denied")
        return NS(total=100, used=40, free=60, percent=40.0)

    monkeypatch.setattr(api_module.psutil, "disk_usage", usage)
    assert [d["letter"] for d in client.get("/drives").json()] == ["C:"]


async def test_slow_drive_does_not_stall_the_route(monkeypatch):
    """A hung network drive answers with null sizes within the probe timeout;
    the healthy drive is unaffected and the route returns promptly."""
    import time
    from backend import api as api_module
    monkeypatch.setattr(api_module, "_DRIVE_PROBE_TIMEOUT_S", 0.2)
    monkeypatch.setattr(api_module, "_volume_label", lambda m: "")
    monkeypatch.setattr(api_module.psutil, "disk_partitions",
                        lambda all=False: [_parts()[0], _parts()[4]])

    def usage(p):
        if p.startswith("Z"):
            time.sleep(1.5)
        return NS(total=100, used=40, free=60, percent=40.0)

    monkeypatch.setattr(api_module.psutil, "disk_usage", usage)
    # Called directly (not through TestClient): the test client's per-request
    # event loop waits for the stuck worker thread on teardown, which is a
    # test artefact -- the real server's loop keeps running.
    t0 = time.monotonic()
    items = {d["letter"]: d for d in await api_module.drives()}
    assert time.monotonic() - t0 < 1.0
    assert items["C:"]["total_bytes"] == 100
    assert items["Z:"]["kind"] == "network" and items["Z:"]["fs"] == "NTFS"
    assert items["Z:"]["total_bytes"] is None and items["Z:"]["free_bytes"] is None


async def test_hung_drive_is_probed_once_across_calls(monkeypatch):
    """Task 14 M4: a probe that timed out and is still stuck is reused by the
    next /drives call instead of starting another thread for the same drive."""
    import threading
    from backend import api as api_module
    monkeypatch.setattr(api_module, "_DRIVE_PROBE_TIMEOUT_S", 0.1)
    monkeypatch.setattr(api_module, "_volume_label", lambda m: "")
    hung = NS(device="Y:\\", mountpoint="Y:\\", fstype="NTFS", opts="rw,remote")
    monkeypatch.setattr(api_module.psutil, "disk_partitions", lambda all=False: [hung])
    release = threading.Event()
    calls = []

    def usage(p):
        calls.append(p)
        release.wait(5)
        return NS(total=100, used=40, free=60, percent=40.0)

    monkeypatch.setattr(api_module.psutil, "disk_usage", usage)
    try:
        for _ in range(3):
            items = await api_module.drives()
            assert items[0]["total_bytes"] is None
        assert calls == ["Y:\\"]
    finally:
        release.set()
    # Once the stuck probe returns, the next call probes afresh and answers.
    api_module._drive_probes.get("y:\\") and api_module._drive_probes["y:\\"].result(5)
    monkeypatch.setattr(api_module, "_DRIVE_PROBE_TIMEOUT_S", 2)
    items = await api_module.drives()
    assert items[0]["total_bytes"] == 100
