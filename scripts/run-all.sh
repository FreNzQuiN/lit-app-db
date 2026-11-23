#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TYPESENSE_API_KEY="${TYPESENSE_API_KEY:-litapp-secret}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-litapp-pass}"

wait_for() {
  local label="$1"; shift
  local tries=0
  until "$@" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then
      echo "GAGAL menunggu: $label"
      exit 1
    fi
    sleep 2
  done
  echo "SIAP: $label"
}

echo "[1/8] Menyalakan kontainer..."
docker compose up -d

echo "[2/8] Menunggu mongod..."
wait_for "cfg1" docker compose exec -T cfg1 mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'
wait_for "shard1p" docker compose exec -T shard1p mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'
wait_for "shard2p" docker compose exec -T shard2p mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'

echo "[3/8] Inisiasi replica set..."
docker compose exec -T mongos mongosh --quiet --file /scripts/01-init-cluster.js

wait_for "primary cfgRS" docker compose exec -T cfg1 mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState === 1 ? quit(0) : quit(1)'
wait_for "primary rs1" docker compose exec -T shard1p mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState === 1 ? quit(0) : quit(1)'
wait_for "primary rs2" docker compose exec -T shard2p mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState === 1 ? quit(0) : quit(1)'
wait_for "mongos" docker compose exec -T mongos mongosh --quiet --eval 'db.adminCommand({ping:1}).ok'

echo "[4/8] Inisiasi shard & skema..."
docker compose exec -T mongos mongosh --quiet --file /scripts/02-init-sharding.js

echo "[5/8] Seed MongoDB..."
docker compose exec -T mongos mongosh --quiet --file /scripts/03-seed.js

echo "[6/8] Seed Typesense..."
wait_for "typesense" curl -sf -H "X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}" http://localhost:18108/health
TYPESENSE_API_KEY="$TYPESENSE_API_KEY" bash scripts/typesense/seed.sh

echo "[7/8] Seed Neo4j..."
wait_for "neo4j" docker compose exec -T neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" 'RETURN 1;'
docker compose exec -T neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" --file /var/lib/neo4j/import/seed.cypher

echo "[8/8] Seed Redis..."
bash scripts/redis/seed.sh

echo "Selesai. Jalankan: bash scripts/verify.sh"
