#!/usr/bin/env python3
"""Tiny static server for the leaderboard.

Run:  python3 serve.py
Then open the printed URL (it also tries to open your browser automatically).
No backend, no database -- it just serves the files in this folder so the
browser can fetch the .xlsx over http (which file:// won't allow).
"""
import http.server
import os
import socketserver
import threading
import webbrowser

PORT = int(os.environ.get("PORT", "8000"))


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"Vendor leaderboard running at {url}")
        print("Press Ctrl+C to stop.")
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
