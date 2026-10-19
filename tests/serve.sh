#!/bin/sh
# Lokalen Testserver starten:  sh tests/serve.sh  → http://localhost:8765
cd "$(dirname "$0")/../public" && exec python3 -m http.server 8765
