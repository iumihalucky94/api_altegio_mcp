#!/bin/bash
# Тест цепочки: ingest → debounce → AI agent. Запуск из корня проекта.
# Использование: ./scripts/test-ai-ingest.sh [текст сообщения]
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Файл .env не найден."
  exit 1
fi

# shellcheck disable=SC1091
source .env 2>/dev/null || true

TOKEN="${MCP_INTERNAL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "В .env задайте MCP_INTERNAL_TOKEN для вызова ingest."
  exit 1
fi

TEXT="${1:-Hallo, ich möchte einen Termin für nächste Woche.}"
PHONE="${TEST_PHONE_E164:-+4367762665083}"

echo "Отправка тестового сообщения в ingest..."
echo "  Телефон: $PHONE"
echo "  Текст: $TEXT"
echo ""

RESP=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3031/ingest/whatsapp-web" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: $TOKEN" \
  -d "{
    \"provider\": \"whatsapp-web\",
    \"provider_message_id\": \"test-$(date +%s)\",
    \"client_phone_e164\": \"$PHONE\",
    \"text\": \"$TEXT\",
    \"ts_iso\": \"$(date -Iseconds)\"
  }")

HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

echo "HTTP $HTTP_CODE"
echo "$BODY" | head -5

if [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "Ingest принят. Через ~20–30 сек (debounce) оркестратор вызовет AI и отправит ответ в WhatsApp."
  echo "Проверьте логи: docker logs altegio_mcp_orchestrator --tail 50"
fi
