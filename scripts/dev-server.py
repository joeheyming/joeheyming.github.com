#!/usr/bin/env python3
"""Local HTTPS dev server for the static site.

Why this exists: the Legend of DOOM runner needs cross-origin isolation,
which needs a service worker, which needs a secure context, which means
HTTPS (or http://localhost). Plain `python3 -m http.server` bound to
0.0.0.0 is great for desktop testing but fails on a phone over LAN
because the LAN IP isn't a secure context.

What it does:
  * Binds to 0.0.0.0 (so any device on the LAN can reach it)
  * Serves the current working directory
  * Auto-generates a self-signed cert on first run and reuses it
  * Split cache policy: no-cache for hand-edited source (HTML, our own
    JS/CSS/JSON) so phone reloads always see the latest edit, but
    `public, max-age=3600` for vendored heavy assets (uzdoom.js,
    .wasm, .data, pk3s, images, audio, fonts) so the phone doesn't
    refetch the 10 MB+ engine payload on every reload. Edit
    CACHEABLE_SUFFIXES / CACHEABLE_PATH_FRAGMENTS below to tune.
  * Picks the first LAN IP it can find and prints a QR-ready URL

Usage:
  python3 scripts/dev-server.py            # HTTPS on :8443
  python3 scripts/dev-server.py --port 443 # needs sudo for <1024
  python3 scripts/dev-server.py --http     # plain HTTP (bypasses cert)

Phone setup (once):
  1. Visit the printed https://192.168.x.y:8443/ URL.
  2. Chrome/Safari will warn about the self-signed cert. Tap
     "Advanced" -> "Proceed to ..." (or equivalent). The browser
     remembers this override for the origin.
  3. You now have a trusted-enough HTTPS origin; service workers
     register, COI lights up, engine boots.

Stop the server with Ctrl+C. The cert is regenerated only if missing;
delete scripts/.dev-cert/ to force a fresh one.
"""

from __future__ import annotations

import argparse
import http.server
import ipaddress
import json
import os
import socket
import socketserver
import ssl
import subprocess
import sys
import time
from pathlib import Path

# When run via `npm run dev`, stdout is a pipe, and Python switches from
# line-buffered to block-buffered. The startup banner and access log
# lines then don't appear until the buffer fills, which makes the
# server look hung. Force line buffering so everything we print shows
# up immediately regardless of how we were spawned.
try:
    sys.stdout.reconfigure(line_buffering=True)
except AttributeError:
    pass


REPO_ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = REPO_ROOT / "scripts" / ".dev-cert"
CERT_PATH = CERT_DIR / "cert.pem"
KEY_PATH = CERT_DIR / "key.pem"


def lan_ips() -> list[str]:
    """Return candidate LAN IPv4 addresses for this host, best first."""
    out: list[str] = []
    try:
        # UDP connect trick: no packet is sent, but the socket resolves
        # which local interface would be used to reach the internet.
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 53))
            out.append(s.getsockname()[0])
        finally:
            s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            try:
                parsed = ipaddress.ip_address(ip)
            except ValueError:
                continue
            if parsed.version == 4 and not parsed.is_loopback and ip not in out:
                out.append(ip)
    except socket.gaierror:
        pass
    return out


def have(cmd: str) -> bool:
    from shutil import which
    return which(cmd) is not None


def generate_cert_mkcert(ips: list[str]) -> None:
    """Generate a cert via mkcert. mkcert provisions a *locally-trusted*
    root CA; once that CA is imported on a client (desktop OS, phone),
    every cert mkcert issues for localhost / LAN IPs is fully trusted —
    no "proceed anyway" click-through. Critical for mobile: Chrome on
    Android will register a service worker on a self-signed HTTPS
    origin whose cert the user bypassed, but will NOT let that worker
    become the page controller, so crossOriginIsolated stays false and
    UZDoom can't boot pthreads. A real-trust cert fixes that."""
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    hosts = ["localhost", "127.0.0.1", "::1", *ips]
    subprocess.run(
        [
            "mkcert",
            "-cert-file", str(CERT_PATH),
            "-key-file", str(KEY_PATH),
            *hosts,
        ],
        check=True,
        capture_output=True,
    )
    os.chmod(KEY_PATH, 0o600)
    print(f"[dev-server] mkcert issued a locally-trusted cert for: {', '.join(hosts)}")


def generate_cert_openssl(ips: list[str]) -> None:
    """Fallback when mkcert isn't installed: produce a self-signed cert
    with a v3 SAN extension. Works for desktop Chrome/Firefox (after
    clicking through the warning) but will NOT satisfy Android Chrome
    enough to let a service worker control the page."""
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    san_entries = ["DNS:localhost", "IP:127.0.0.1", "IP:::1"]
    for ip in ips:
        san_entries.append(f"IP:{ip}")
    config = f"""
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
req_extensions     = req_ext
distinguished_name = dn

[dn]
CN = localhost-dev

[req_ext]
subjectAltName = {",".join(san_entries)}
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
"""
    config_path = CERT_DIR / "openssl.cnf"
    config_path.write_text(config)
    # 825 days is the Apple-enforced max for leaf certs; anything higher
    # gets rejected on modern iOS/macOS even for self-signed. Doesn't
    # matter for dev, but the shorter expiry is harmless.
    subprocess.run(
        [
            "openssl", "req",
            "-x509", "-nodes", "-newkey", "rsa:2048",
            "-keyout", str(KEY_PATH),
            "-out", str(CERT_PATH),
            "-days", "825",
            "-config", str(config_path),
            "-extensions", "req_ext",
        ],
        check=True,
        capture_output=True,
    )
    os.chmod(KEY_PATH, 0o600)
    print(f"[dev-server] generated self-signed cert covering: {', '.join(san_entries)}")


def ensure_cert(ips: list[str], prefer_openssl: bool = False) -> str:
    """Create cert+key if missing. Returns 'mkcert' or 'openssl' to
    indicate which backend was used, so we can tailor the startup
    banner (phone setup differs a lot between the two)."""
    # Detect backend used previously so phone instructions stay accurate
    # across restarts when the cert is already cached on disk.
    state_path = CERT_DIR / "backend.txt"
    if CERT_PATH.exists() and KEY_PATH.exists():
        if state_path.exists():
            return state_path.read_text().strip() or "openssl"
        return "openssl"

    print("[dev-server] no dev cert yet; generating one...")
    backend = "openssl"
    try:
        if have("mkcert") and not prefer_openssl:
            generate_cert_mkcert(ips)
            backend = "mkcert"
        elif have("openssl"):
            generate_cert_openssl(ips)
            backend = "openssl"
        else:
            sys.exit("[dev-server] neither mkcert nor openssl on PATH; install one or pass --http")
    except subprocess.CalledProcessError as e:
        sys.exit(f"[dev-server] cert generation failed:\n{e.stderr.decode(errors='replace')}")
    state_path.write_text(backend)
    return backend


# Assets we don't edit during a normal dev session — the Emscripten
# engine output (uzdoom.js/worker.js/.wasm/.data), mod pk3s, images,
# audio, fonts. These are large (the wasm alone is >10 MB) and
# no-caching them makes every phone reload refetch the entire engine,
# which is painful on cellular and slow even on Wi-Fi.
#
# Two buckets:
#   * CACHEABLE_SUFFIXES: file extensions that are always safe to cache
#     in a dev context (binary / media / the Emscripten data bundle).
#   * CACHEABLE_PATH_FRAGMENTS: substrings that also pin the path to
#     vendored code we don't edit. (Reserved — currently empty; the
#     uz-doom engine glue at /doom/uzdoom.js is pinned via
#     CACHEABLE_EXACT_PATHS instead so adjacent hand-edited files like
#     uzdoom-loader.js stay no-cache.)
#
# Everything else falls through to no-cache, so hand-edited HTML/JS/CSS
# on this repo keeps showing up on the phone on the next reload without
# a manual cache clear.
CACHEABLE_SUFFIXES = (
    ".wasm", ".data", ".wad",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".mp3", ".ogg", ".wav", ".m4a",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
)
# Intentionally NOT cached: .pk3 / .zip. pk3 files tend to be under
# active iteration during mod work (re-pack music, tweak MAPINFO,
# etc.), and a 1-hour client cache means every rebuild is invisible
# to the phone until it expires. They're still big (~8 MB), so expect
# slower reloads while iterating — worth it for reliable turnaround.
CACHEABLE_EXACT_PATHS = (
    # Emscripten-output JS for uzdoom. Intentionally narrow so that
    # uzdoom-loader.js / uzdoom-melt.js (which we DO maintain and edit
    # alongside the engine glue) stay no-cache.
    "/doom/uzdoom.js",
)
CACHEABLE_PATH_FRAGMENTS = ()
CACHE_MAX_AGE_SECONDS = 3600


def is_cacheable(path: str) -> bool:
    lower = path.lower()
    # Strip query string so ?v=3 cache-busters don't defeat the suffix
    # check — SimpleHTTPRequestHandler already passes `self.path`
    # which includes it.
    if "?" in lower:
        lower = lower.split("?", 1)[0]
    if lower.endswith(CACHEABLE_SUFFIXES):
        return True
    if lower in CACHEABLE_EXACT_PATHS:
        return True
    return any(frag in lower for frag in CACHEABLE_PATH_FRAGMENTS)


PHONELOG_SNIPPET = b'<script src="/scripts/phone-console.js"></script>'


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with split caching policy.

    Hand-edited source (HTML / our own JS / CSS / JSON) is served with
    `no-store, no-cache, must-revalidate, max-age=0`, so a save-and-
    reload loop on the phone works without any cache clearing.

    Heavy vendored assets (uzdoom.js/.wasm/.data, mod pk3s, images,
    fonts, audio) are served with `public, max-age=3600` plus the
    default Last-Modified header that SimpleHTTPRequestHandler already
    produces. That way phone reloads stay fast on the 10 MB+ engine
    payload, but still revalidate once an hour in case we do replace
    the wasm.

    Also handles dev-only HTML rewriting: when a request URL carries
    `?phonelog=1`, the response body for HTML files is rewritten to
    inject `<script src="/scripts/phone-console.js"></script>` right
    after the opening `<head>` tag. That way the production HTML
    never references the relay script, but any page becomes phone-
    debuggable just by appending the query param.
    """

    def address_string(self) -> str:
        # Quiet the default "localhost - - [timestamp]" one-liner's use
        # of reverse-DNS lookups; they hang the handler for 5s when
        # the phone's hostname doesn't resolve.
        return self.client_address[0]

    # Suppress per-request access logging for /__devlog (every
    # console.log from the phone generates one, which drowns out the
    # actual phone output). Regular file requests still log.
    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and "/__devlog" in args[0]:
            return
        super().log_message(fmt, *args)

    def do_GET(self) -> None:
        if self._maybe_inject_phonelog():
            return
        super().do_GET()

    def _wants_phonelog(self) -> bool:
        if "?" not in self.path:
            return False
        query = self.path.split("?", 1)[1]
        for pair in query.split("&"):
            if pair == "phonelog=1" or pair.startswith("phonelog=1#"):
                return True
        return False

    def _resolve_html_path(self) -> str | None:
        """Map the request to an HTML file on disk, or None if this
        request isn't serving HTML. Mirrors SimpleHTTPRequestHandler's
        directory-index resolution so `/youtube/`, `/youtube/index.html`,
        and `/` all behave the same."""
        fs_path = self.translate_path(self.path)
        if os.path.isdir(fs_path):
            for index in ("index.html", "index.htm"):
                candidate = os.path.join(fs_path, index)
                if os.path.exists(candidate):
                    return candidate
            return None
        if fs_path.lower().endswith((".html", ".htm")) and os.path.isfile(fs_path):
            return fs_path
        return None

    def _maybe_inject_phonelog(self) -> bool:
        """If this is a `?phonelog=1` request for an HTML file, rewrite
        the body to inject the relay script and serve it ourselves.
        Returns True if the request was handled."""
        if not self._wants_phonelog():
            return False
        path = self._resolve_html_path()
        if path is None:
            return False
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return False

        # Inject right after the first `<head ...>` tag so the relay
        # patches console.* before any of the page's own scripts run.
        lower = body.lower()
        head_open = lower.find(b"<head")
        if head_open >= 0:
            close_idx = body.find(b">", head_open)
            if close_idx >= 0:
                body = body[: close_idx + 1] + PHONELOG_SNIPPET + body[close_idx + 1 :]
            else:
                # Malformed but recoverable: prepend the snippet.
                body = PHONELOG_SNIPPET + body
        else:
            body = PHONELOG_SNIPPET + body

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # `end_headers` below appends the no-cache headers via the
        # override, so we don't need to send Cache-Control here.
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_POST(self) -> None:
        # Phone-console relay endpoint. Accepts a JSON payload of the
        # shape { batch: [{level, t, msg}...], ua, href } and prints
        # each entry to stdout with a [phone LEVEL] prefix. Replies
        # 204 so the client doesn't bother parsing a body.
        if self.path.split("?", 1)[0] in ("/__devlog", "/__devlog/"):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                data = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                data = {}
            ua = str(data.get("ua") or "?")[:60]
            # Extract a short device tag so multi-device debugging stays
            # readable: "iPhone", "Android 14; Pixel 7", etc.
            tag = "phone"
            if "iPhone" in ua or "iPad" in ua or "iPod" in ua:
                tag = "iOS"
            elif "Android" in ua:
                tag = "Android"
            for entry in data.get("batch") or []:
                level = str(entry.get("level") or "log").upper()
                msg = str(entry.get("msg") or "")
                ts = time.strftime("%H:%M:%S")
                # Color-free output keeps the lines copy-pasteable into
                # bug reports. One line per entry even if msg has
                # newlines in it — otherwise grepping the terminal
                # scrollback breaks.
                flat = msg.replace("\n", " ⏎ ")
                print(f"[{tag} {ts} {level:5s}] {flat}", flush=True)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return
        # Anything else: let SimpleHTTPRequestHandler return its usual
        # 501 Unsupported method, which is fine for static dev serving.
        self.send_response(405)
        self.end_headers()

    def end_headers(self) -> None:
        if is_cacheable(self.path):
            self.send_header("Cache-Control",
                             f"public, max-age={CACHE_MAX_AGE_SECONDS}")
        else:
            self.send_header("Cache-Control",
                             "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()


class ReusingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Threaded so multiple asset fetches from the engine don't
    serialise behind each other, and with SO_REUSEADDR so a fast Ctrl+C
    / restart cycle doesn't stall on TIME_WAIT."""

    allow_reuse_address = True
    daemon_threads = True


def print_phone_setup(backend: str, ips: list[str], port: int) -> None:
    """Emit the *right* phone setup recipe for the cert backend in use.
    Getting this wrong is frustrating on a phone: self-signed and
    mkcert have different click paths, and mkcert additionally needs
    the root CA installed once per device."""
    print("")
    if backend == "mkcert":
        ca_root = subprocess.run(
            ["mkcert", "-CAROOT"], check=True, capture_output=True, text=True
        ).stdout.strip()
        ca_pem = Path(ca_root) / "rootCA.pem"
        print("[dev-server] cert issued by mkcert (locally trusted).")
        print("[dev-server] Phone setup (one time):")
        print(f"[dev-server]   1. Copy the root CA to the phone: {ca_pem}")
        # Expose the CA over the same server for easy in-browser install.
        # Phones can download it from any LAN URL the server is serving,
        # so rootCA.pem at /dev-ca.pem is the simplest path.
        lan_hint = ips[0] if ips else "localhost"
        print(f"[dev-server]      (or open https://{lan_hint}:{port}/dev-ca.pem in the "
              "phone browser — accept the cert warning ONCE to download the root)")
        print("[dev-server]   2. Install it as a CA cert on the phone:")
        print("[dev-server]      • Android: Settings → Security → Encryption & "
              "credentials → Install a certificate → CA certificate.")
        print("[dev-server]      • iOS: AirDrop/email the .pem, open it, Settings → "
              "Profile Downloaded → Install. Then Settings → General → About → "
              "Certificate Trust Settings → enable full trust for 'mkcert ...'.")
        print("[dev-server]   3. Reload this server URL on the phone; cert is now trusted.")
    else:
        print("[dev-server] cert is self-signed (openssl fallback).")
        print("[dev-server] Phone warning: the self-signed override lets you VIEW the")
        print("[dev-server] page on the phone, but Chrome on Android will silently")
        print("[dev-server] refuse to let the service worker control the page — which")
        print("[dev-server] means crossOriginIsolated stays false and UZDoom can't")
        print("[dev-server] start its pthread workers. Recommended fixes:")
        print("[dev-server]   • Install mkcert (brew install mkcert && mkcert -install),")
        print("[dev-server]     delete scripts/.dev-cert/, restart this server.")
        print("[dev-server]   • Or run over plain HTTP and add the origin to")
        print("[dev-server]     chrome://flags/#unsafely-treat-insecure-origin-as-secure")
        print("[dev-server]     on the phone.")


def serve_ca_pem(backend: str) -> bytes | None:
    """Return the mkcert root CA PEM bytes, or None when the cert
    backend can't expose one. Used to serve /dev-ca.pem from the HTTPS
    dev origin (and the HTTP fallback below) so phones can install it
    from the browser without AirDrop/email juggling."""
    if backend != "mkcert":
        return None
    try:
        ca_root = subprocess.run(
            ["mkcert", "-CAROOT"], check=True, capture_output=True, text=True
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    ca_pem = Path(ca_root) / "rootCA.pem"
    if not ca_pem.exists():
        return None
    return ca_pem.read_bytes()


def make_handler(ca_pem_bytes: bytes | None) -> type:
    """Build a request handler class closed over the optional CA bytes.
    Routing /dev-ca.pem -> the CA bytes means the phone can download
    the trust root from the same server that's also serving the site,
    which saves a mess of AirDrop/email/USB steps."""

    class Handler(NoCacheHandler):
        def do_GET(self) -> None:
            if ca_pem_bytes is not None and self.path in ("/dev-ca.pem", "/dev-ca.pem/"):
                self.send_response(200)
                # application/x-x509-ca-cert triggers the "install
                # certificate" UI on iOS; on Android Chrome the user
                # sees a download they then route through system
                # settings. Either way, mime type matters.
                self.send_header("Content-Type", "application/x-x509-ca-cert")
                self.send_header("Content-Length", str(len(ca_pem_bytes)))
                self.send_header("Content-Disposition",
                                 'attachment; filename="dev-ca.pem"')
                self.end_headers()
                self.wfile.write(ca_pem_bytes)
                return
            super().do_GET()

    return Handler


def run(port: int, use_https: bool, directory: Path, prefer_openssl: bool) -> None:
    os.chdir(directory)
    ips = lan_ips()

    scheme = "http"
    ca_pem_bytes: bytes | None = None
    backend = "openssl"
    if use_https:
        backend = ensure_cert(ips, prefer_openssl=prefer_openssl)
        ca_pem_bytes = serve_ca_pem(backend)

    httpd = ReusingServer(("0.0.0.0", port), make_handler(ca_pem_bytes))

    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(CERT_PATH), keyfile=str(KEY_PATH))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    print(f"[dev-server] serving {directory} on :{port} "
          f"({scheme.upper()}, no-cache for source, "
          f"max-age={CACHE_MAX_AGE_SECONDS} for wasm/pk3/media)")
    print(f"[dev-server]   local:    {scheme}://localhost:{port}/")
    for ip in ips:
        print(f"[dev-server]   lan:      {scheme}://{ip}:{port}/")
    if ca_pem_bytes is not None and ips:
        print(f"[dev-server]   ca-cert:  {scheme}://{ips[0]}:{port}/dev-ca.pem  "
              "(open on phone to install mkcert root)")
    if use_https:
        print_phone_setup(backend, ips, port)
    print("")
    print("[dev-server] Phone console relay:")
    print("[dev-server]   Add ?phonelog=1 to any URL on the phone; console.log")
    print("[dev-server]   and unhandled errors from the phone will appear here")
    print("[dev-server]   tagged [Android HH:MM:SS LEVEL].")
    print("[dev-server] Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[dev-server] stopping.")
    finally:
        httpd.server_close()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=None,
                        help="Listen port (default: 8443 for HTTPS, 8000 for HTTP).")
    parser.add_argument("--http", action="store_true",
                        help="Serve plain HTTP (skips cert generation).")
    parser.add_argument("--prefer-openssl", action="store_true",
                        help="Use openssl even if mkcert is installed. "
                             "Not recommended; mkcert produces a cert that "
                             "real browsers (incl. Android Chrome) accept for "
                             "service-worker registration.")
    parser.add_argument("--dir", type=Path, default=REPO_ROOT,
                        help="Directory to serve (default: repo root).")
    args = parser.parse_args(argv)
    use_https = not args.http
    port = args.port if args.port is not None else (8443 if use_https else 8000)
    run(
        port=port,
        use_https=use_https,
        directory=args.dir.resolve(),
        prefer_openssl=args.prefer_openssl,
    )


if __name__ == "__main__":
    main()
