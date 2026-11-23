#!/usr/bin/env bash
set -euo pipefail

API_KEY="${TYPESENSE_API_KEY:-litapp-secret}"
HOST="${TYPESENSE_HOST:-http://localhost:18108}"
cd "$(dirname "${BASH_SOURCE[0]}")"  # path relatif agar curl.exe Windows bisa membaca file

hdr=(-H "X-TYPESENSE-API-KEY: ${API_KEY}" -H "Content-Type: application/json")

echo "Menghapus koleksi books jika ada..."
curl -s -X DELETE "${HOST}/collections/books" "${hdr[@]}" >/dev/null || true

echo "Membuat koleksi books..."
curl -s -X POST "${HOST}/collections" "${hdr[@]}" --data-binary @"./schema-books.json"
echo

echo "Mengimpor dokumen..."
curl -s -X POST "${HOST}/collections/books/documents/import?action=upsert" \
  -H "X-TYPESENSE-API-KEY: ${API_KEY}" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @"./books.jsonl"
echo

echo "Jumlah dokumen:"
curl -s "${HOST}/collections/books" "${hdr[@]}"
echo
