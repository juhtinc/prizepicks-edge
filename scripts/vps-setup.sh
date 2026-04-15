#!/bin/bash
# Sports Lore VPS Setup Script
# Run as root on Contabo Ubuntu 24.04

set -e
echo "=== Sports Lore VPS Setup ==="

# 1. Update system
echo "[1/7] Updating system..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Install dependencies
echo "[2/7] Installing dependencies..."
apt-get install -y -qq curl wget git python3 python3-pip nodejs npm docker.io docker-compose-v2 ffmpeg

# 3. Install yt-dlp
echo "[3/7] Installing yt-dlp..."
pip3 install -U "yt-dlp[default]" --break-system-packages

# 4. Setup Cloudflare WARP
echo "[4/7] Setting up Cloudflare WARP..."
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflare-client.list
apt-get update -qq
apt-get install -y -qq cloudflare-warp

# Register WARP (non-interactive)
warp-cli registration new || true
warp-cli mode proxy
warp-cli proxy port 40000
warp-cli connect

echo "WARP status:"
warp-cli status

# 5. Test yt-dlp through WARP proxy
echo "[5/7] Testing yt-dlp through Cloudflare WARP..."
yt-dlp --proxy socks5://127.0.0.1:40000 \
  -f "best[height<=480]/best" \
  --js-runtimes node \
  -o "/tmp/test_clip.mp4" \
  --no-playlist --socket-timeout 30 \
  "https://www.youtube.com/watch?v=wV9CMVdY3dM" 2>&1 | tail -10 || true

if [ -f "/tmp/test_clip.mp4" ]; then
  echo "SUCCESS: YouTube download works through WARP! ($(du -h /tmp/test_clip.mp4 | cut -f1))"
  rm /tmp/test_clip.mp4
else
  echo "WARP test failed, trying direct..."
  yt-dlp -f "best[height<=480]/best" \
    --js-runtimes node \
    -o "/tmp/test_clip2.mp4" \
    --no-playlist --socket-timeout 30 \
    "https://www.youtube.com/watch?v=wV9CMVdY3dM" 2>&1 | tail -10 || true
  if [ -f "/tmp/test_clip2.mp4" ]; then
    echo "SUCCESS: Direct download works! (no WARP needed)"
    rm /tmp/test_clip2.mp4
  else
    echo "BOTH FAILED - will need further debugging"
  fi
fi

# 6. Setup the clip API
echo "[6/7] Setting up clip processing API..."
mkdir -p /opt/sports-lore
# Copy server.js — SCP it to /opt/sports-lore/server.js before running setup,
# or it will be created from the local scripts/vps-server.js
if [ ! -f /opt/sports-lore/server.js ]; then
  echo "WARNING: /opt/sports-lore/server.js not found. SCP scripts/vps-server.js to the VPS first."
  echo "  scp scripts/vps-server.js root@YOUR_VPS:/opt/sports-lore/server.js"
  exit 1
fi
# To update: scp scripts/vps-server.js root@194.163.180.19:/opt/sports-lore/server.js && ssh root@194.163.180.19 systemctl restart clip-api

# 7. Create systemd service
echo "[7/7] Creating systemd service..."
cat > /etc/systemd/system/clip-api.service << 'SVCEOF'
[Unit]
Description=Sports Lore Clip API
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/sports-lore/server.js
Restart=always
RestartSec=5
Environment=CLIP_API_SECRET=sports-lore-clips-2026
Environment=USE_WARP=true
Environment=PATH=/root/.deno/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable clip-api
systemctl start clip-api

# Open firewall port
ufw allow 3456/tcp 2>/dev/null || true

echo ""
echo "=== SETUP COMPLETE ==="
echo "Clip API: http://$(curl -s ifconfig.me):3456/health"
echo "Test: curl http://$(curl -s ifconfig.me):3456/health"
echo ""
