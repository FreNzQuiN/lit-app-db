# Lit App — Database Layer

Perpustakaan digital kampus berbasis polyglot NoSQL: MongoDB, Typesense, Neo4j, dan Redis dalam satu topologi multi-tenant sharded.

Repo ini berisi definisi skema, skrip inisialisasi klaster, dan data contoh untuk **layer database** Lit App. REST API, frontend, dan logika autentikasi tidak termasuk; ruang lingkupnya dijelaskan di `DOKUMENTASI.md` §1.

## Isi repo

| Path | Isi |
| --- | --- |
| `DOKUMENTASI.md` | Spesifikasi lengkap: model data, topologi, langkah menjalankan, backup, troubleshooting |
| `docker-compose.yml` | Versi lite, 12 layanan — 6 MongoDB, 4 Redis, 1 Typesense, 1 Neo4j (`name: lit-app-db`) |
| `.env.example` | Contoh `TYPESENSE_API_KEY` dan `NEO4J_PASSWORD` |
| `.gitignore` | Mengecualikan `.env` dan `backup-*/` |
| `.gitattributes` | Memaksa akhir baris LF agar skrip bash jalan di Windows |
| `scripts/run-all.sh` | Menyalakan kontainer, inisiasi replica set & shard, lalu seed keempat engine |
| `scripts/verify.sh` | Memeriksa jumlah dokumen, node, dan key setelah seed |

Skrip per engine:

| Path | Fungsi |
| --- | --- |
| `scripts/mongo/01-init-cluster.js` | Inisiasi replica set `cfgRS`, `rs1`, `rs2` |
| `scripts/mongo/02-init-sharding.js` | Daftarkan shard, validator `$jsonSchema`, index, zona tenant, shard key |
| `scripts/mongo/03-seed.js` | Data contoh: users, books, loans, reviews |
| `scripts/typesense/schema-books.json` | Definisi koleksi `books` (proyeksi pencarian) |
| `scripts/typesense/books.jsonl` | Data contoh proyeksi buku |
| `scripts/typesense/seed.sh` | Buat koleksi dan impor dokumen |
| `scripts/neo4j/seed.cypher` | Constraint, node `:User`/`:Book`/`:Category`, relasi |
| `scripts/neo4j/queries.cypher` | Contoh query rekomendasi collaborative filtering |
| `scripts/redis/seed.sh` | Isi sesi, stok, dan cache per shard |

## Kenapa empat database

| Engine | Peran di repo ini |
| --- | --- |
| MongoDB | Source of truth untuk `users`, `books`, `loans`, `reviews`; skema fleksibel, shard key `{tenantId, <entityId>}` |
| Typesense | Indeks pencarian read-only dari MongoDB — typo tolerance, autocomplete, faceting |
| Neo4j | Traversal relasi `:PINJAM` untuk rekomendasi; satu instance Community Edition |
| Redis | Sesi (TTL 24 jam), stok atomik via `DECR`, cache rekomendasi dan pencarian |

Dua tenant contoh: `ub` (Universitas Brawijaya, dikunci ke `shard1` lewat zona `zona_ub`) dan `unair` (Universitas Airlangga, `shard2` lewat `zona_unair`). Isinya 9 user, 9 buku, 9 pinjaman, dan 4 review — rinciannya di `DOKUMENTASI.md` §8.

## Menjalankan

Prasyarat: Docker Desktop / Docker Engine 24+ dengan Compose v2, `curl`, `bash` (di Windows pakai Git Bash), RAM kosong ±2 GB, port `27017`, `7474`, `7687`, `18108` bebas.

```bash
git clone https://github.com/FreNzQuiN/lit-app-db.git
cd lit-app-db
cp .env.example .env              # opsional, untuk mengganti kredensial
bash scripts/run-all.sh           # nyalakan + init + seed semua
bash scripts/verify.sh            # cek isi keempat database
```

`verify.sh` berakhir dengan `SEMUA PASS` bila seed berhasil, termasuk cek bahwa data `ub` hanya ada di shard1, data `unair` hanya di shard2, dan secondary/slave sudah menyalin data. Matikan dengan `docker compose down` (tambah `-v` untuk menghapus data).

Akses setelah berjalan: MongoDB `mongosh mongodb://localhost:27017/litapp`, Typesense `http://localhost:18108/health`, Neo4j `http://localhost:7474` (`neo4j` / `litapp-pass`), Redis `docker compose exec -T redis-s1m redis-cli`.

## Batasan

- Ini bukan aplikasi: tidak ada REST API, UI, login, pembayaran, atau notifikasi.
- Pipeline sinkronisasi MongoDB → Typesense/Neo4j hanya dijelaskan sebagai konsep; change-stream produksi tidak diimplementasikan.
- MongoDB berjalan tanpa autentikasi internal karena berada di network Docker privat — tidak siap produksi apa adanya.
- Kredensial di `.env.example` adalah nilai contoh; simpan yang asli di `.env` (gitignored).
- Neo4j Community Edition tidak menyediakan replikasi; ketahanan data mengandalkan dump/restore.
- Versi lite memakai 1 config server dan 2 anggota per shard (produksi: 3 dan 3), jadi replikasi ada tetapi tidak ada failover otomatis. Lihat `DOKUMENTASI.md` §3.5.

## Dokumentasi

`DOKUMENTASI.md` memuat panduan lengkap: topologi, zona tenant, dan versi lite (§3), model data kanonik (§4), langkah manual langkah-demi-langkah (§6), detail tiap engine (§7), backup & restore (§10), dan troubleshooting (§11).
