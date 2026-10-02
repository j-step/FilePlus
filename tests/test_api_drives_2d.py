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
