# coding=utf-8
"""
SSRF-focused validation for the OctoPrint webcam snapshot URL used by BedReady.

Kept stdlib-only and outside octoprint_bedready/__init__.py's OctoPrint/Flask
import chain so it can be unit tested without an OctoPrint environment.
"""

import ipaddress
import socket
import urllib.parse


def validate_snapshot_url(snapshot_url):
    """
    Raise ValueError if snapshot_url is not an acceptable http(s) URL to fetch
    a webcam snapshot from.

    Deliberately ALLOWS RFC1918/private network addresses (192.168.x.x,
    10.x.x.x, 172.16-31.x.x): local IP webcams and ESP32-CAM modules on the
    LAN are this plugin's primary supported use case (see PR #30 maintainer
    feedback).

    Rejects:
      - non-http(s) schemes (e.g. file://, ftp://)
      - URLs with no hostname
      - hostnames that fail to resolve
      - hostnames that resolve (IPv4 or IPv6) to a loopback, link-local
        (including the 169.254.169.254 cloud metadata address), multicast,
        or unspecified (0.0.0.0 / ::) address

    Known limitation (not addressed here): this validates the resolved
    address up front, but requests.get() does its own DNS resolution when it
    connects, so a DNS record that changes between validation and the
    request (DNS rebinding) could bypass this check. Pinning the resolved IP
    at the connection level would close that gap but is disproportionate for
    an admin-configured, low-risk URL.
    """
    parsed = urllib.parse.urlparse(snapshot_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("webcam snapshot url must use the http or https scheme.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("webcam snapshot url is missing a hostname.")

    try:
        addr_infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise ValueError("unable to resolve webcam snapshot url host.")

    if not addr_infos:
        raise ValueError("unable to resolve webcam snapshot url host.")

    for _family, _type, _proto, _canonname, sockaddr in addr_infos:
        address = sockaddr[0].split("%", 1)[0]  # strip IPv6 zone id, if present
        try:
            resolved_ip = ipaddress.ip_address(address)
        except ValueError:
            raise ValueError("unable to resolve webcam snapshot url host.")

        if (
            resolved_ip.is_loopback
            or resolved_ip.is_link_local
            or resolved_ip.is_multicast
            or resolved_ip.is_unspecified
        ):
            raise ValueError("webcam snapshot url resolves to a disallowed network address.")
