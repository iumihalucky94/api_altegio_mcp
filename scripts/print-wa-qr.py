#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print WhatsApp Web QR code as ASCII in the terminal (no browser)."""
import json
import sys
import os
import urllib.parse

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(script_dir, 'qr-response.json')
    if not os.path.exists(json_path):
        print("Сначала получите QR: ./scripts/get-wa-qr.sh", file=sys.stderr)
        sys.exit(1)
    with open(json_path) as f:
        data = json.load(f)
    qr_string = data.get('qr')
    if not qr_string:
        print("В qr-response.json нет поля qr (возможно, уже авторизованы).", file=sys.stderr)
        sys.exit(1)
    try:
        import qrcode
    except ImportError:
        url = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + urllib.parse.quote(qr_string)
        url_path = os.path.join(script_dir, "qr-url.txt")
        with open(url_path, "w") as uf:
            uf.write(url + "\n")
        print("\n  Модуль qrcode не установлен. Откройте ссылку ниже — откроется картинка QR, отсканируйте её в WhatsApp:\n")
        print("  " + url + "\n")
        print("  Ссылка также сохранена в: " + url_path)
        print("  (откройте на телефоне в браузере или на другом ПК; в WhatsApp: Связанные устройства → Привязать)\n")
        sys.exit(1)
    qr = qrcode.QRCode(box_size=1, border=2)
    qr.add_data(qr_string)
    qr.make(fit=True)
    print("\n  === Отсканируйте QR в WhatsApp (Связанные устройства) ===\n")
    for row in qr.modules:
        line = "".join("██" if cell else "  " for cell in row)
        print("  " + line)
    print("\n  (██ = чёрное, пробелы = белое)\n")

if __name__ == "__main__":
    main()
