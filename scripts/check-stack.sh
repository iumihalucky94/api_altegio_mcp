#!/bin/bash
# Проверка работы стека. Запуск: ./scripts/check-stack.sh
# Для проверки QR экспортируйте токен: export MCP_INTERNAL_TOKEN=ваш_токен
set -e
cd "$(dirname "$0")/.."

echo "=== 1. Gateway health ==="
curl -s http://localhost:3030/health && echo ""

echo "=== 2. Orchestrator health ==="
curl -s http://localhost:3031/health && echo ""

echo "=== 3. WhatsApp QR (если задан MCP_INTERNAL_TOKEN) ==="
if [ -n "$MCP_INTERNAL_TOKEN" ]; then
  code=$(curl -s -o /tmp/wa_qr.json -w "%{http_code}" -H "x-internal-token: $MCP_INTERNAL_TOKEN" http://localhost:3030/whatsapp/qr)
  echo "GET /whatsapp/qr → HTTP $code"
  [ "$code" = "200" ] && echo "QR сохранён в /tmp/wa_qr.json (поле qr)" || true
else
  echo "Экспортируйте MCP_INTERNAL_TOKEN из .env и запустите снова для проверки QR."
fi

echo ""
echo "=== 4. Контейнеры ==="
docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || true
