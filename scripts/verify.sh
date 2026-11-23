#!/usr/bin/env bash
set -uo pipefail

export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TYPESENSE_API_KEY="${TYPESENSE_API_KEY:-litapp-secret}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-litapp-pass}"
FAILED=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS $label = $actual"
  else
    echo "FAIL $label: expected $expected, got $actual"
    FAILED=1
  fi
}

mcount() {
  docker compose exec -T mongos mongosh --quiet litapp --eval "db.$1.countDocuments({})" 2>/dev/null | tr -d '\r' | tail -n1
}

ncount() {
  docker compose exec -T neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" --format plain "$1" 2>/dev/null | tr -d '\r' | tail -n1
}

echo "MongoDB (mongos, sharded):"
check "users" 9 "$(mcount users)"
check "books" 9 "$(mcount books)"
check "loans" 9 "$(mcount loans)"
check "reviews" 4 "$(mcount reviews)"

echo "MongoDB (sebaran tenant per shard, dibaca langsung dari tiap shard):"
scount() {
  docker compose exec -T "$1" mongosh --quiet litapp --eval "db.getMongo().setReadPref('$2'); db.books.countDocuments({tenantId: '$3'})" 2>/dev/null | tr -d '\r' | tail -n1
}
check "shard1 primary: buku ub" 6 "$(scount shard1p primary ub)"
check "shard1 primary: buku unair" 0 "$(scount shard1p primary unair)"
check "shard2 primary: buku unair" 3 "$(scount shard2p primary unair)"
check "shard1 secondary (replika): buku ub" 6 "$(scount shard1s1 secondary ub)"
check "shard2 secondary (replika): buku unair" 3 "$(scount shard2s1 secondary unair)"

echo "Typesense:"
TS_N=$(curl -s -H "X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}" http://localhost:18108/collections/books | grep -o '"numDocuments":[0-9]*' | cut -d: -f2 | head -n1)
check "books indexed" 9 "$TS_N"

echo "Neo4j:"
check "User nodes" 9 "$(ncount 'MATCH (n:User) RETURN count(n);')"
check "Book nodes" 9 "$(ncount 'MATCH (n:Book) RETURN count(n);')"
check "Category nodes" 14 "$(ncount 'MATCH (n:Category) RETURN count(n);')"
check "PINJAM edges" 9 "$(ncount 'MATCH ()-[r:PINJAM]->() RETURN count(r);')"

echo "Redis:"
S1=$(docker compose exec -T redis-s1m redis-cli GET "book:ub:b-ub-01:stok" 2>/dev/null | tr -d '\r')
check "stok ub b-ub-01" 5 "$S1"
TTL1=$(docker compose exec -T redis-s1m redis-cli TTL "sess:token-ub-01" 2>/dev/null | tr -d '\r')
if [ "$TTL1" -gt 0 ] 2>/dev/null; then echo "PASS TTL sesi ub = $TTL1"; else echo "FAIL TTL sesi ub = $TTL1"; FAILED=1; fi
S2=$(docker compose exec -T redis-s2m redis-cli GET "book:unair:b-unair-01:stok" 2>/dev/null | tr -d '\r')
check "stok unair b-unair-01" 6 "$S2"
R1=$(docker compose exec -T redis-s1s redis-cli GET "book:ub:b-ub-01:stok" 2>/dev/null | tr -d '\r')
check "slave s1 menyalin stok ub" 5 "$R1"

if [ "$FAILED" -eq 0 ]; then
  echo "SEMUA PASS"
  exit 0
else
  echo "ADA FAIL"
  exit 1
fi
