#!/usr/bin/env python3
"""
Dev server for Terrain Walker.

Use this instead of `python -m http.server`.

On Windows, Python's http.server takes MIME types from the registry, where .js
is often registered as text/plain. Browsers refuse to execute ES modules served
with a non-JavaScript MIME type, so the page loads and none of the code runs.
This server sets the types explicitly and sidesteps the whole problem.

    python serve.py            # http://localhost:8080/
    python serve.py 9000       # a different port
"""

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".md": "text/markdown",
        "": "application/octet-stream",
    }

    def end_headers(self):
        # No caching, so a reload always picks up edits.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Terrain Walker  ->  http://localhost:{PORT}/")
        print(f"Diagnostics     ->  http://localhost:{PORT}/diag.html")
        print("Ctrl-C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
