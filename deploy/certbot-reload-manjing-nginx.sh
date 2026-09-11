#!/bin/sh
set -eu

# Install in /etc/letsencrypt/renewal-hooks/deploy/ on the production host.
# Reload only after this site's certificate has been renewed successfully.
if [ "${RENEWED_LINEAGE:-}" != "/etc/letsencrypt/live/manjing.kakayiduo.cloud" ]; then
  exit 0
fi

/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
