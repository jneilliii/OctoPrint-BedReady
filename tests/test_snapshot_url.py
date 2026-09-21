# coding=utf-8
"""
Tests for octoprint_bedready.snapshot_url.validate_snapshot_url.

Loaded directly by file path (not via `import octoprint_bedready`) because
octoprint_bedready/__init__.py imports flask/octoprint.plugin, which aren't
installed in a plain dev environment. snapshot_url.py is stdlib-only, so
loading it this way doesn't require OctoPrint to be installed.
"""

import importlib.util
import socket
from pathlib import Path

import pytest

_MODULE_PATH = Path(__file__).resolve().parent.parent / "octoprint_bedready" / "snapshot_url.py"
_spec = importlib.util.spec_from_file_location("bedready_snapshot_url", _MODULE_PATH)
snapshot_url = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(snapshot_url)

validate_snapshot_url = snapshot_url.validate_snapshot_url


@pytest.mark.parametrize(
    "url",
    [
        "http://192.168.1.50/snapshot.jpg",
        "http://10.0.0.25/camera.jpg",
        "http://172.16.0.20/image.jpg",
    ],
)
def test_allows_local_network_cameras(url):
    validate_snapshot_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://192.168.1.50/image",
        "http://127.0.0.1:8080/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "",
        "not a url",
        "http://",
    ],
)
def test_rejects_disallowed_urls(url):
    with pytest.raises(ValueError):
        validate_snapshot_url(url)


def test_allows_hostname_resolving_to_private_address(monkeypatch):
    def fake_getaddrinfo(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("192.168.1.50", 0))]

    monkeypatch.setattr(snapshot_url.socket, "getaddrinfo", fake_getaddrinfo)
    validate_snapshot_url("http://camera.local/snapshot.jpg")


def test_rejects_hostname_resolving_to_metadata_address(monkeypatch):
    def fake_getaddrinfo(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("169.254.169.254", 0))]

    monkeypatch.setattr(snapshot_url.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ValueError):
        validate_snapshot_url("http://camera.local/snapshot.jpg")


def test_rejects_if_any_resolved_address_is_disallowed(monkeypatch):
    def fake_getaddrinfo(host, port, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("192.168.1.50", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, 0, "", ("::1", 0, 0, 0)),
        ]

    monkeypatch.setattr(snapshot_url.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ValueError):
        validate_snapshot_url("http://camera.local/snapshot.jpg")


def test_rejects_unresolvable_hostname(monkeypatch):
    def fake_getaddrinfo(host, port, **kwargs):
        raise socket.gaierror("name resolution failed")

    monkeypatch.setattr(snapshot_url.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ValueError):
        validate_snapshot_url("http://camera.local/snapshot.jpg")
