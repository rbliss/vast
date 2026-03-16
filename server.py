#!/usr/bin/env python3
"""Terrain dev server with screenshot upload API.

Serves static files and provides:
  POST /api/screenshot  — upload a screenshot (base64 PNG/JPEG in JSON body)
  GET  /api/screenshots — list saved screenshots
  GET  /verification/*  — serve saved screenshots
"""

import http.server
import json
import base64
import os
import time
from urllib.parse import urlparse, parse_qs

VERIFICATION_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "verification")
os.makedirs(VERIFICATION_DIR, exist_ok=True)

class TerrainHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/screenshot":
            self._handle_screenshot_upload()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == "/api/screenshots":
            self._handle_list_screenshots()
        else:
            super().do_GET()

    def _handle_screenshot_upload(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        image_data = data.get("image", "")
        label = data.get("label", "screenshot")
        fmt = data.get("format", "png")

        # Strip data URI prefix if present
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        try:
            raw = base64.b64decode(image_data)
        except Exception:
            self.send_error(400, "Invalid base64 image data")
            return

        # Sanitize label
        safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
        ts = time.strftime("%Y%m%d_%H%M%S")
        filename = f"{ts}_{safe_label}.{fmt}"
        filepath = os.path.join(VERIFICATION_DIR, filename)

        with open(filepath, "wb") as f:
            f.write(raw)

        result = {
            "ok": True,
            "filename": filename,
            "path": f"/verification/{filename}",
            "size": len(raw),
        }
        self._json_response(201, result)
        print(f"[screenshot] saved {filename} ({len(raw)} bytes)")

    def _handle_list_screenshots(self):
        files = []
        for name in sorted(os.listdir(VERIFICATION_DIR)):
            if name.lower().endswith((".png", ".jpg", ".jpeg")):
                full = os.path.join(VERIFICATION_DIR, name)
                files.append({
                    "filename": name,
                    "path": f"/verification/{name}",
                    "size": os.path.getsize(full),
                    "modified": os.path.getmtime(full),
                })
        self._json_response(200, {"screenshots": files})

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress noisy static file logs, keep API logs
        if "/api/" in (args[0] if args else ""):
            super().log_message(format, *args)


if __name__ == "__main__":
    PORT = 8080
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(("0.0.0.0", PORT), TerrainHandler)
    print(f"[server] Terrain dev server on http://0.0.0.0:{PORT}")
    print(f"[server] Screenshots → {VERIFICATION_DIR}")
    server.serve_forever()
