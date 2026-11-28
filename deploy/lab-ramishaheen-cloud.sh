#!/bin/bash
# Put the Labs live on the ramishaheen.cloud server:
#   1. add the "Labs" pill to the live homepage (backup first, safe to run twice)
#   2. install the labs site at /opt/ohmycompany/sites/lab.ramishaheen.cloud
#   3. serve lab.ramishaheen.cloud with the web server already running (Caddy or nginx), config checked before reload
#   4. check DNS and the result
# Usage (as root on the server):  bash lab-ramishaheen-cloud.sh [craft-reverse-commit]
set -euo pipefail

SRC_SHA="${1:-31888b116cefb32983bbe2d711701cad9f90f74f}"   # Craft-reverse- commit with the finished, themed labs
SITES=/opt/ohmycompany/sites
MAIN="$SITES/ramishaheen.cloud"
LAB="$SITES/lab.ramishaheen.cloud"
HOST=lab.ramishaheen.cloud
STAMP=$(date -u +%Y%m%d%H%M%S)
BK=/root/site-backups/labs-$STAMP

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root (sudo bash $0)"; exit 1; }
[ -d "$MAIN" ] || { echo "Can't find $MAIN — is this the ramishaheen.cloud server?"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
mkdir -p "$BK"
echo "backups: $BK"

# ---------------------------------------------------------------- 1. Labs pill
say "1/4 Labs pill on the homepage"
cp -a "$MAIN/index.html" "$BK/index.html"
python3 - "$MAIN/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if 'lb-btn' in s:
    print('already there, nothing to do'); sys.exit(0)
css = ('    .lbg .lb-b{transform-box:fill-box;transform-origin:center;animation:lbBub 2.4s ease-in-out infinite;animation-delay:calc(var(--i) * .5s)}\n'
       '    @keyframes lbBub{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-2.5px);opacity:1}}\n')
pill = ('<a class="kv-btn lb-btn" href="https://lab.ramishaheen.cloud/" aria-label="Labs: build a robot car in 3D and break live system design simulations">'
        '<svg class="vg lbg" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M12.5 3.5h7M13.5 3.5v8.5L5.5 25.5a2 2 0 0 0 1.7 3h17.6a2 2 0 0 0 1.7-3L18.5 12V3.5"/><path d="M8.6 20.5h14.8"/>'
        '<g fill="currentColor" stroke="none"><circle class="lb-b" style="--i:0" cx="13" cy="24.5" r="1.5"/><circle class="lb-b" style="--i:1" cx="18.5" cy="23" r="1.2"/>'
        '<circle class="lb-b" style="--i:2" cx="16" cy="17" r="1"/></g></svg><span>Labs</span></a>\n      ')
css_anchor = '    .tvg .tv-rec{'
pill_anchor = '<a class="kv-btn fc-btn"'
if s.count(css_anchor) != 1 or s.count(pill_anchor) != 1:
    print('homepage layout not recognised (anchors missing); pill NOT added'); sys.exit(2)
s = s.replace(css_anchor, css + css_anchor, 1).replace(pill_anchor, pill + pill_anchor, 1)
tmp = p + '.labs-tmp'
open(tmp, 'w', encoding='utf-8').write(s)
import os; os.replace(tmp, p)
print('pill added')
PY

# ---------------------------------------------------------------- 2. labs files
say "2/4 Labs site files"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/ramishaheen/Craft-reverse-/tar.gz/$SRC_SHA" -o "$TMP/src.tgz"
tar -xzf "$TMP/src.tgz" -C "$TMP" --wildcards '*/twin-labs/*'
NEW=$(find "$TMP" -maxdepth 2 -type d -name twin-labs | head -1)
[ -f "$NEW/index.html" ] && [ -f "$NEW/systems/sims/load-balancing.js" ] && [ -f "$NEW/rover/index.js" ] || { echo "download looks incomplete"; exit 1; }
[ -d "$LAB" ] && mv "$LAB" "$BK/lab-previous"
mkdir -p "$SITES"
cp -a "$NEW" "$LAB"
chown -R 33:33 "$LAB" 2>/dev/null || true
echo "installed $(find "$LAB" -type f | wc -l) files in $LAB"

# ---------------------------------------------------------------- 3. web server
say "3/4 Web server"
WEBSRV=""
if command -v ss >/dev/null; then
  L=$(ss -ltnp 2>/dev/null | grep -E ':(443|80)\s' || true)
  case "$L" in *caddy*) WEBSRV=caddy;; *nginx*) WEBSRV=nginx;; *apache2*|*httpd*) WEBSRV=apache;; *docker-proxy*) WEBSRV=docker;; esac
fi
echo "web server on 80/443: ${WEBSRV:-unknown}"
case "$WEBSRV" in
  caddy)
    CF=/etc/caddy/Caddyfile
    [ -f "$CF" ] || { echo "Caddy is running but $CF is missing; add a site for $HOST pointing at $LAB by hand"; exit 3; }
    if grep -q "^$HOST" "$CF"; then echo "Caddyfile already has $HOST"; else
      cp -a "$CF" "$BK/Caddyfile"
      printf '\n%s {\n\troot * %s\n\tencode zstd gzip\n\theader /index.html Cache-Control "no-cache"\n\tfile_server\n}\n' "$HOST" "$LAB" >> "$CF"
      if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy && echo "Caddy reloaded (it gets the HTTPS certificate by itself once DNS points here)";
      else cp -a "$BK/Caddyfile" "$CF"; echo "Caddy rejected the new config; restored the old one"; caddy validate --config "$CF" --adapter caddyfile || true; exit 3; fi
    fi ;;
  nginx)
    NC=/etc/nginx/sites-available/$HOST
    if [ -f "$NC" ] || grep -rqs "server_name.*$HOST" /etc/nginx/; then echo "nginx already has $HOST"; else
      cat > "$NC" <<NG
server {
    listen 80;
    listen [::]:80;
    server_name $HOST;
    root $LAB;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
    location ~* \.(js|css|json)\$ { add_header Cache-Control "public, max-age=86400, must-revalidate"; }
    location ~* \.(woff2|png|svg|webp)\$ { add_header Cache-Control "public, max-age=2592000"; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    types { text/javascript js mjs; font/woff2 woff2; }
    include /etc/nginx/mime.types;
}
NG
      [ -d /etc/nginx/sites-enabled ] && ln -sf "$NC" /etc/nginx/sites-enabled/$HOST
      if nginx -t 2>/dev/null; then systemctl reload nginx && echo "nginx reloaded";
      else rm -f "/etc/nginx/sites-enabled/$HOST" "$NC"; echo "nginx rejected the config; removed it"; nginx -t || true; exit 3; fi
    fi ;;
  *)
    echo "I don't manage this web server automatically. Files are in $LAB; point $HOST at that folder in your server's site config."
    ;;
esac

# ---------------------------------------------------------------- 4. DNS + checks
say "4/4 DNS and checks"
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DNS=$( (getent ahostsv4 "$HOST" 2>/dev/null || true) | awk 'NR==1{print $1}')
echo "this server: $IP   $HOST resolves to: ${DNS:-nothing yet}"
if [ "$DNS" != "$IP" ]; then
  echo ">> Add this DNS record where ramishaheen.cloud's DNS is managed (Hostinger: Domains → DNS / Nameservers → DNS records):"
  echo ">>   Type A   Name lab   Points to $IP   TTL 300"
fi
if [ "$WEBSRV" = nginx ] && command -v certbot >/dev/null && [ "$DNS" = "$IP" ]; then
  certbot --nginx -d "$HOST" --non-interactive --agree-tos --redirect -m "admin@$HOST" || echo "certbot did not finish; run: certbot --nginx -d $HOST"
fi
grep -q 'lb-btn' "$MAIN/index.html" && echo "homepage: Labs pill present" || echo "homepage: Labs pill MISSING"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" http://127.0.0.1/ || true)
echo "local check http://$HOST via this server: HTTP $code (200 or a 301/308 redirect to https is good)"
echo
echo "Done. Backups are in $BK. To undo the pill: cp -a $BK/index.html $MAIN/index.html"
