#!/bin/bash
# Получить QR для первого входа в WhatsApp Web и открыть страницу с QR
cd "$(dirname "$0")/.."
set -a && source .env 2>/dev/null && set +a
if [ -z "$MCP_INTERNAL_TOKEN" ]; then
  echo "В .env не задан MCP_INTERNAL_TOKEN."
  exit 1
fi
curl -s -H "x-internal-token: $MCP_INTERNAL_TOKEN" http://localhost:3032/whatsapp/qr > scripts/qr-response.json
if grep -q '"qr":' scripts/qr-response.json 2>/dev/null; then
  python3 -c "
import json
with open('scripts/qr-response.json') as f:
    qr = json.load(f).get('qr', '')
with open('scripts/show-wa-qr.html') as f:
    html = f.read()
html = html.replace('REPLACE_QR', qr.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"'))
with open('scripts/show-wa-qr.html', 'w') as f:
    f.write(html)
print('QR обновлён.')
"
  echo "Вывод QR в терминал (или ссылка на картинку, если нет python3-qrcode):"
  python3 scripts/print-wa-qr.py 2>/dev/null || true
else
  echo "QR не получен (возможно, уже авторизованы или wa-service не готов). Проверьте: docker compose logs wa-service --tail 5"
fi
