#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

s1() { docker compose exec -T redis-s1m redis-cli "$@"; }
s2() { docker compose exec -T redis-s2m redis-cli "$@"; }

echo "Menyiapkan shard Redis 1 (tenant ub)..."
s1 FLUSHDB
s1 SET "sess:token-ub-01" '{"userId":"u-ub-01","tenantId":"ub","role":"mahasiswa"}' EX 86400
s1 SET "sess:token-ub-02" '{"userId":"u-ub-02","tenantId":"ub","role":"mahasiswa"}' EX 86400
s1 SET "book:ub:b-ub-01:stok" 5
s1 SET "book:ub:b-ub-02:stok" 1
s1 SET "book:ub:b-ub-03:stok" 8
s1 SET "rec:ub:245150700111044" '["b-ub-03"]' EX 21600
s1 SET "search:a1b2c3" '{"q":"basis data","tenantId":"ub","hits":["b-ub-01","b-ub-06"]}' EX 600

echo "Menyiapkan shard Redis 2 (tenant unair)..."
s2 FLUSHDB
s2 SET "sess:token-unair-01" '{"userId":"u-unair-01","tenantId":"unair","role":"mahasiswa"}' EX 86400
s2 SET "book:unair:b-unair-01:stok" 6
s2 SET "book:unair:b-unair-02:stok" 3
s2 SET "search:d4e5f6" '{"q":"manajemen","tenantId":"unair","hits":["b-unair-02"]}' EX 600

echo "Verifikasi cepat:"
echo -n "stok b-ub-01 = "; s1 GET "book:ub:b-ub-01:stok"
echo -n "ttl sess ub  = "; s1 TTL "sess:token-ub-01"
echo -n "rec ub       = "; s1 GET "rec:ub:245150700111044"
