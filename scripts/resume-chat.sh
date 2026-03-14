#!/bin/bash
# Вернуть диалог в состояние BOT_ACTIVE (ИИ снова будет отвечать).
# Использование: ./scripts/resume-chat.sh +4367762665083
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && source .env 2>/dev/null || true
PHONE="${1:-}"
if [ -z "$PHONE" ]; then
  echo "Usage: $0 +4367762665083"
  exit 1
fi
TOKEN="${MCP_INTERNAL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "Set MCP_INTERNAL_TOKEN in .env"
  exit 1
fi
curl -s -X POST "http://localhost:3031/admin/resume" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: $TOKEN" \
  -d "{\"client_phone_e164\": \"$PHONE\"}"
echo ""
