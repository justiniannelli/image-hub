#!/usr/bin/env bash
# Make a dated backup of the database and images in your home folder.
# Copy it to your own computer with:  scp -i <key> ubuntu@<server-ip>:image-hub-backup-*.tar.gz .
set -euo pipefail
OUT="$HOME/image-hub-backup-$(date +%Y-%m-%d).tar.gz"
sudo systemctl stop image-hub
tar -czf "$OUT" -C /var/lib image-hub
sudo systemctl start image-hub
echo "Backup saved to $OUT"
