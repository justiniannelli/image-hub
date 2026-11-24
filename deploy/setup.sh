#!/usr/bin/env bash
# One-time setup for Image Hub on an Ubuntu server (made for Oracle Cloud's free Ampere/ARM VM).
# Run it from inside the cloned repo:   bash deploy/setup.sh
# Safe to run again: it skips what is already done.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR=/var/lib/image-hub
ENV_FILE=/etc/image-hub.env
RUN_USER="$(id -un)"

say() { printf '\n\033[1;35m== %s\033[0m\n' "$*"; }

say "Installing system packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates openssl

# Small servers (1 GB RAM) can run out of memory while building the front end. Add swap if needed.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  say "Adding a 2 GB swap file (this server has little memory)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Installing Node.js 22"
need_node=1
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
fi
if [ "$need_node" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node $(node -v)"

say "Installing the app and building the front end"
cd "$APP_DIR"
npm ci --omit=dev
npm run build

say "Settings (stored in $ENV_FILE, readable only by you and root)"
if sudo test -f "$ENV_FILE"; then
  echo "Settings already exist; keeping them. Edit with: sudo nano $ENV_FILE"
else
  read -rsp "Choose a password for the app: " APP_PASSWORD; echo
  read -rsp "Gemini API key (paste, then Enter): " GEMINI_API_KEY; echo
  read -rsp "OpenAI API key (Enter to skip): " OPENAI_API_KEY; echo
  SESSION_SECRET="$(openssl rand -hex 32)"
  sudo install -m 600 -o "$RUN_USER" /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
APP_PASSWORD=$APP_PASSWORD
SESSION_SECRET=$SESSION_SECRET
GEMINI_API_KEY=$GEMINI_API_KEY
OPENAI_API_KEY=$OPENAI_API_KEY
EOF
  unset APP_PASSWORD GEMINI_API_KEY OPENAI_API_KEY SESSION_SECRET
fi

say "Creating the data folder ($DATA_DIR)"
sudo mkdir -p "$DATA_DIR"
sudo chown "$RUN_USER":"$RUN_USER" "$DATA_DIR"

say "Setting it to start automatically"
sudo tee /etc/systemd/system/image-hub.service >/dev/null <<EOF
[Unit]
Description=Image Hub
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production DATA_DIR=$DATA_DIR PORT=3000 HOST=127.0.0.1
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now image-hub
sudo systemctl restart image-hub
sleep 2
if curl -fsS http://127.0.0.1:3000/api/me >/dev/null; then echo "Image Hub is running."; else
  echo "Image Hub did not start. See the log with: journalctl -u image-hub -n 50"; exit 1; fi

say "Connecting this server to your Tailscale network"
if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Open the link below and sign in with the same Tailscale account you use on your devices."
  sudo tailscale up --hostname image-hub
fi
# Private HTTPS address, reachable only from your Tailscale devices.
sudo tailscale serve --bg 3000

say "Done"
sudo tailscale serve status
echo
echo "Open the https:// address above on any device signed in to Tailscale."
echo "To update later:  bash $APP_DIR/deploy/update.sh"
