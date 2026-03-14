#!/bin/sh
# Remove Chromium singleton locks from previous container so WhatsApp Web can start.
AUTH_DIR="${WA_WEB_AUTH_DIR:-/app/.wwebjs_auth}"
SESSION_DIR="$AUTH_DIR/session-wa-service"
for f in SingletonLock SingletonCookie SingletonSocket; do
  [ -f "$SESSION_DIR/$f" ] && rm -f "$SESSION_DIR/$f"
done
exec "$@"
