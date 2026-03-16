#!/bin/sh
# Remove Chromium singleton locks from previous container so WhatsApp Web can start.
AUTH_DIR="${WA_WEB_AUTH_DIR:-/app/.wwebjs_auth}"
# Remove in session dir (whatsapp-web.js LocalAuth path; may be symlinks)
SESSION_DIR="$AUTH_DIR/session-wa-service"
for f in SingletonLock SingletonCookie SingletonSocket; do
  [ -e "$SESSION_DIR/$f" ] && rm -f "$SESSION_DIR/$f"
done
# Remove any Singleton* under auth dir (symlinks or files; Chromium uses symlinks)
if [ -d "$AUTH_DIR" ]; then
  find "$AUTH_DIR" \( -type f -o -type l \) -name 'Singleton*' 2>/dev/null | while read -r f; do rm -f "$f"; done
fi
exec "$@"
