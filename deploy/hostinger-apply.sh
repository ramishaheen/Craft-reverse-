#!/bin/sh
# Runs inside a one-shot container on the ramishaheen.cloud VPS (started through Hostinger's Docker manager).
# Mounts expected:
#   /site     = /opt/ohmycompany/sites/ramishaheen.cloud   (served by ohmycompany-nginx-1 at /var/www/ramishaheen.cloud)
#   /conf     = /opt/ohmycompany/nginx/conf.d
#   /backups  = /root/site-backups
#   /var/run/docker.sock
# Steps: Labs pill on the homepage, labs files in /site/lab, nginx server block for lab.ramishaheen.cloud
# (validated with nginx -t before every reload, rolled back on failure), certificate via the existing certbot setup.
set -eu

SRC_SHA="${1:-31888b116cefb32983bbe2d711701cad9f90f74f}"   # labs source commit; the first argument overrides it
HOST=lab.ramishaheen.cloud
NGINX=ohmycompany-nginx-1
STAMP=$(date -u +%Y%m%d%H%M%S)
BK=/backups/labs-$STAMP
CONF=/conf/$HOST.conf
mkdir -p "$BK"
apk add --no-cache curl >/dev/null
echo "backups: $BK"

nginx_ok() { docker exec "$NGINX" nginx -t 2>&1 | tail -2; docker exec "$NGINX" nginx -t >/dev/null 2>&1; }
reload() { docker exec "$NGINX" nginx -s reload; echo "nginx reloaded"; }

# ------------------------------------------------------------- 1. Labs pill
echo "== 1/4 Labs pill"
cp -a /site/index.html "$BK/index.html"
if grep -q 'lb-btn' /site/index.html; then
  echo "pill already present"
else
  CSS_ANCHOR='    .tvg .tv-rec{'
  PILL_ANCHOR='<a class="kv-btn fc-btn"'
  [ "$(grep -cF "$CSS_ANCHOR" /site/index.html)" = 1 ] && [ "$(grep -cF "$PILL_ANCHOR" /site/index.html)" = 1 ] || { echo "homepage anchors not found; pill NOT added"; exit 2; }
  cat > /tmp/css.txt <<'EOF'
    .lbg .lb-b{transform-box:fill-box;transform-origin:center;animation:lbBub 2.4s ease-in-out infinite;animation-delay:calc(var(--i) * .5s)}
    @keyframes lbBub{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-2.5px);opacity:1}}
EOF
  cat > /tmp/pill.txt <<'EOF'
      <a class="kv-btn lb-btn" href="https://lab.ramishaheen.cloud/" aria-label="Labs: build a robot car in 3D and break live system design simulations"><svg class="vg lbg" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 3.5h7M13.5 3.5v8.5L5.5 25.5a2 2 0 0 0 1.7 3h17.6a2 2 0 0 0 1.7-3L18.5 12V3.5"/><path d="M8.6 20.5h14.8"/><g fill="currentColor" stroke="none"><circle class="lb-b" style="--i:0" cx="13" cy="24.5" r="1.5"/><circle class="lb-b" style="--i:1" cx="18.5" cy="23" r="1.2"/><circle class="lb-b" style="--i:2" cx="16" cy="17" r="1"/></g></svg><span>Labs</span></a>
EOF
  awk -v ca="$CSS_ANCHOR" -v pa="$PILL_ANCHOR" '
    index($0, ca) == 1 { while ((getline l < "/tmp/css.txt") > 0) print l }
    index($0, pa) > 0  { while ((getline l < "/tmp/pill.txt") > 0) print l }
    { print }' /site/index.html > /tmp/index.new
  [ "$(grep -c 'lb-btn' /tmp/index.new)" = 1 ] || { echo "patch check failed; homepage unchanged"; exit 2; }
  cat /tmp/index.new > /site/index.html   # write in place: keeps owner, mode and the file the server has open
  echo "pill added"
fi

# ------------------------------------------------------------- 2. labs files
echo "== 2/4 Labs files"
curl -fsSL "https://codeload.github.com/ramishaheen/Craft-reverse-/tar.gz/$SRC_SHA" -o /tmp/src.tgz
mkdir -p /tmp/src && tar -xzf /tmp/src.tgz -C /tmp/src
NEW=$(find /tmp/src -maxdepth 2 -type d -name twin-labs | head -1)
[ -f "$NEW/index.html" ] && [ -f "$NEW/systems/sims/load-balancing.js" ] && [ -f "$NEW/rover/index.js" ] || { echo "download incomplete"; exit 1; }
rm -f "$NEW/.htaccess"
[ -d /site/lab ] && mv /site/lab "$BK/lab-previous"
cp -a "$NEW" /site/lab
chown -R 33:33 /site/lab
echo "installed $(find /site/lab -type f | wc -l) files"

# ------------------------------------------------------------- 3. nginx, plain HTTP first
echo "== 3/4 nginx"
[ -f "$CONF" ] && cp -a "$CONF" "$BK/"
cat > "$CONF" <<EOF
# Labs (Rover Lab + Systems Lab) — files live in ramishaheen.cloud/lab
server {
listen 80;
server_name $HOST;
location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
root /var/www/ramishaheen.cloud/lab;
index index.html;
location / { try_files \$uri \$uri/ =404; }
}
EOF
if nginx_ok; then reload; else rm -f "$CONF"; [ -f "$BK/$HOST.conf" ] && cp -a "$BK/$HOST.conf" "$CONF"; echo "nginx rejected the config; removed it"; exit 3; fi

# ------------------------------------------------------------- 4. certificate + HTTPS
echo "== 4/4 HTTPS"
if docker run --rm -v /opt/ohmycompany/certbot/www:/var/www/certbot -v /opt/ohmycompany/certbot/conf:/etc/letsencrypt certbot/certbot \
     certonly --webroot -w /var/www/certbot -d "$HOST" --non-interactive --agree-tos --keep-until-expiring --no-eff-email --register-unsafely-without-email; then
  cp -a "$CONF" /tmp/http-only.conf
  cat > "$CONF" <<EOF
# Labs (Rover Lab + Systems Lab) — files live in ramishaheen.cloud/lab
server {
listen 80;
server_name $HOST;
location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
location / { return 301 https://$HOST\$request_uri; }
}

server {
listen 443 ssl;
http2 on;
server_name $HOST;
ssl_certificate /etc/letsencrypt/live/$HOST/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/$HOST/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;

add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000" always;

root /var/www/ramishaheen.cloud/lab;
index index.html;

location = /index.html { add_header Cache-Control "no-cache"; add_header X-Content-Type-Options "nosniff" always; }
location ~* \.(js|css|json)\$ { add_header Cache-Control "public, max-age=3600, must-revalidate"; add_header X-Content-Type-Options "nosniff" always; try_files \$uri =404; }
location ~* \.(woff2|png|jpe?g|svg|webp|ico)\$ { expires 30d; add_header Cache-Control "public"; try_files \$uri =404; }
location ~ /\. { deny all; return 404; }
location / { try_files \$uri \$uri/ =404; }
}
EOF
  if nginx_ok; then reload; echo "HTTPS on"; else cp -a /tmp/http-only.conf "$CONF"; nginx_ok && reload; echo "HTTPS config rejected; kept the plain HTTP site"; fi
else
  echo "certbot could not get a certificate yet (DNS may still be propagating); the site is served over plain HTTP for now — run this again later"
fi

echo "== check"
grep -q 'lb-btn' /site/index.html && echo "homepage: Labs pill present"
ls -l "$CONF"
echo "LABS-DEPLOY-DONE"
