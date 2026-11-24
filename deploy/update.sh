#!/usr/bin/env bash
# Pull the latest code from GitHub, rebuild, and restart. Your images and database are not touched.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
git pull
npm ci --omit=dev
npm run build
sudo systemctl restart image-hub
sleep 2
curl -fsS http://127.0.0.1:3000/api/me >/dev/null && echo "Updated and running." \
  || { echo "Not running. See: journalctl -u image-hub -n 50"; exit 1; }
