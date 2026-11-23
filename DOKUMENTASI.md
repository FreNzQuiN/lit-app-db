# Lit App — Implementasi Layer Database & Isinya

**Perpustakaan Digital Kampus Berbasis Polyglot NoSQL**
Mode distribusi: **Multi-Tenant Sharded (Tiered SaaS, jalur Shared)**

Dokumen ini menjelaskan dan memandu implementasi **layer database beserta data contohnya** untuk Lit App. Layer aplikasi (REST API, frontend, logika autentikasi, orkestrasi bisnis) **tidak** termasuk dalam cakupan.

---

## 1. Ringkasan

Lit App memakai empat sistem penyimpanan, masing-masing untuk satu kebutuhan data yang berbeda:

| Sistem | Peran | Alasan pemilihan (dari presentasi) |
|---|---|---|
| **MongoDB** | Data utama & katalog (User, Book, Loan, Review) | Skema fleksibel untuk jenis koleksi tak seragam; pola akses agregat diambil utuh sekali baca tanpa JOIN |
| **Typesense** | Pencarian & autocomplete | Typo tolerance, autocomplete, ranking, faceting; proyeksi read-only dari MongoDB; ringan (satu binary) |
| **Neo4j** | Sistem rekomendasi | Traversal edge relasi murah untuk collaborative filtering; menghindari self-join bertingkat |
| **Redis** | Session & cache | Latensi sub-milidetik, TTL, decrement stok atomik; meringankan beban baca tiga database lain |

### Ruang lingkup

**Termasuk:**
- Definisi skema/koleksi/index/validator di keempat engine
- Topologi klaster sharded versi lite (config server, 2 shard replica set, mongos, Redis master–slave, Typesense, Neo4j tunggal)
- Skrip inisialisasi, skrip seed, skrip verifikasi
- Data contoh untuk dua tenant kampus

**Tidak termasuk:**
- Kode aplikasi/API/UI
- Logika login, pembayaran, notifikasi
- Pipeline sinkronisasi real-time production (di dokumen ini dijelaskan sebagai konsep, bukan diimplementasikan sebagai layanan)

---

## 2. Requirement yang Dilayani Layer Database

### Functional

| Aktor | Kebutuhan | Engine pendukung |
|---|---|---|
| Mahasiswa / Dosen | Mencari buku | Typesense (pencarian) + MongoDB (detail) |
| Mahasiswa / Dosen | Meminjam, mengembalikan | MongoDB (`loans`) + Redis (`book:{id}:stok`) |
| Mahasiswa / Dosen | Review & rating | MongoDB (`reviews`) |
| Admin / Pustakawan | CRUD katalog & stok | MongoDB (`books`) + Redis (invalidasi cache stok) |
| Admin / Pustakawan | Verifikasi pinjam & kembali | MongoDB (`loans`, field `status`) |

### Non-Functional

- Pencarian cepat dan toleran salah ketik → Typesense
- Autocomplete dan filter/faceting → Typesense
- Rekomendasi berbasis perilaku peminjaman pengguna lain → Neo4j
- Latensi baca rendah untuk sesi dan stok → Redis
- Isolasi antar kampus → shard key berawalan `tenantId` + zona per tenant

---

## 3. Model Distribusi: Multi-Tenant Sharded

Presentasi menjelaskan empat pendekatan: Multi-Tenant SaaS, On-Premise (single node), Open Source (federasi node mandiri), dan sistem akhir **Tiered SaaS**. Implementasi ini mengambil jalur **Shared/Tenant sharded** sebagai entry point.

### 3.1 Topologi

```
                         ┌──────────────┐
                         │    mongos    │  port 27017 (router, satu titik masuk)
                         └──────┬───────┘
                ┌────────────────┼────────────────┐
                │                │                │
        ┌───────▼───────┐ ┌──────▼──────┐ ┌───────▼───────┐
        │ cfgRS (1 node)│ │  shard rs1  │ │  shard rs2    │
        │ cfg1          │ │ 1P + 1S     │ │ 1P + 1S       │
        │               │ │ zona_ub     │ │ zona_unair    │
        └───────────────┘ └──────┬──────┘ └───────┬───────┘
                                 │                │
                     ┌───────────▼──────┐ ┌───────▼───────────┐
                     │ Redis s1 master  │ │ Redis s2 master   │
                     │ + 1 slave        │ │ + 1 slave         │
                     │ tenant: ub       │ │ tenant: unair     │
                     └──────────────────┘ └───────────────────┘

        Typesense: 1 node
        Neo4j: 1 instance Community Edition
```

### 3.2 Bentuk database per engine

**MongoDB.** Koleksi `users`, `books`, `loans`, `reviews` di-shard dengan shard key berawalan `tenantId`. Tiap shard adalah replica set berisi 1 primary (master) dan 1 secondary (slave). Primary menangani semua tulis; secondary menyalin data primary dan bisa melayani baca. Penempatan tenant dikunci dengan **zone sharding**: tenant `ub` → `shard1`, tenant `unair` → `shard2`. Balancer tetap memindahkan chunk otomatis di dalam zona saat volume tumbuh.

**Redis.** Berjalan mengikuti pembagian shard. Master menyimpan `sess:` (TTL 24 jam), `book:{tenantId}:{id}:stok`, `rec:` (TTL 6 jam), dan `search:` (TTL 10 menit). Slave menyalin data master yang sama.

**Typesense.** Satu node pada versi lite (versi produksi: klaster tiga node dengan Raft). Indeks bersifat proyeksi asinkron dari MongoDB, sehingga kehilangan indeks tidak menghilangkan data asli — indeks dibangun ulang dari MongoDB.

**Neo4j.** Satu instance Community Edition (tidak menyediakan replikasi/klaster). Traversal dibatasi maksimal dua hop untuk menjaga biaya query. Ketahanan data mengandalkan dump/restore berkala.

### 3.3 Trade-off yang diterima

| Benefit | Trade-off |
|---|---|
| Biaya infrastruktur terbagi; patch cukup sekali | Kegagalan layanan bersama mengenai semua tenant |
| Tenant baru langsung aktif | Tenant aktivitas tinggi bisa menumpuk di satu shard |
| Isolasi data per tenant lewat shard key | Konsistensi primary–secondary dan pemindahan primary menambah kompleksitas operasional |

### 3.4 Catatan shard key

Presentasi menyebut shard key `tenantId`. Implementasi memakai **shard key majemuk** `{ tenantId, <entityId> }` (mis. `{tenantId:1, bookId:1}`). Alasannya: MongoDB mewajibkan indeks unik diawali shard key agar `_id` tetap unik lintas shard, dan kardinalitas majemuk menyebarkan chunk lebih merata saat satu tenant sangat besar. `tenantId` tetap menjadi awalan, sehingga data satu tenant berdekatan.

Shard key saja **tidak menjamin** tenant tertentu tinggal di shard tertentu — MongoDB bebas menaruh chunk di shard mana pun, dan dengan data sekecil contoh ini semuanya akan menumpuk di satu shard. Karena itu `02-init-sharding.js` memasang **zona**:

```javascript
sh.addShardToZone("shard1", "zona_ub")
sh.updateZoneKeyRange("litapp.books",
  { tenantId: "ub", bookId: MinKey }, { tenantId: "ub", bookId: MaxKey }, "zona_ub")
```

Rentang zona dipasang sebelum `shardCollection`, sehingga chunk tenant langsung dibuat di shard yang benar. Kampus baru cukup ditambahkan ke objek `tenantZones`.

### 3.5 Versi lite

Supaya bisa jalan di laptop biasa, topologi dibuat seminimal mungkin tanpa menghilangkan konsep sharding dan master-slave:

| Komponen | Produksi (presentasi) | Versi lite (repo ini) |
|---|---|---|
| Config server | 3 node | 1 node |
| Anggota per shard | 1 primary + 2 secondary | 1 primary + 1 secondary |
| Redis | master + slave per shard | sama (2 pasang) |
| Typesense | klaster 3 node | 1 node |
| Neo4j | 1 instance | 1 instance, heap 384 MB |
| Total kontainer / RAM | 18 / ±6 GB | 12 / ±1,5–2 GB |

Konsekuensi: dengan 2 anggota per shard, data tetap tereplikasi, tetapi bila primary mati secondary tidak bisa mengangkat dirinya menjadi primary (butuh mayoritas suara). Failover otomatis butuh minimal 3 anggota.

---

## 4. Model Data Kanonik

Ini adalah sumber kebenaran yang dipakai keempat engine. ID yang sama muncul di MongoDB, Typesense, Neo4j, dan Redis.

### 4.1 Entitas

| Entitas | ID | Field utama |
|---|---|---|
| `User` | `userId` | `tenantId`, `nim`, `nama`, `role`, `prodi`, `angkatan`, `email` |
| `Book` | `bookId` | `tenantId`, `judul`, `tipe`, `pengarang`, `kategori[]`, `metadata_spesifik`, `stok`, `tersedia`, `tahun` |
| `Loan` | `loanId` | `tenantId`, `userId`, `bookId`, `tglPinjam`, `batasKembali`, `tglDikembalikan`, `status` |
| `Review` | `reviewId` | `tenantId`, `userId`, `bookId`, `rating` (1–5), `komentar`, `tgl` |

Nilai `role`: `mahasiswa`, `dosen`, `admin`, `pustakawan`.
Nilai `tipe`: `buku_teks`, `skripsi`, `novel`, `jurnal`, `ebook`.
Nilai `status`: `dipinjam`, `dikembalikan`, `terlambat`.
`batasKembali` = batas waktu pengembalian; `tglDikembalikan` = tanggal buku benar-benar dikembalikan (tidak ada bila masih dipinjam).

### 4.2 Pemetaan ke empat engine

| Entitas | MongoDB | Typesense | Neo4j | Redis |
|---|---|---|---|---|
| User | koleksi `users` | — | node `:User` | `sess:{token}` (data sesi) |
| Book | koleksi `books` | koleksi `books` (proyeksi) | node `:Book` | `book:{tenantId}:{id}:stok` |
| Kategori | field `kategori[]` | facet `kategori` | node `:Category` + relasi `:BERKATEGORI` | — |
| Loan | koleksi `loans` | — | relasi `:PINJAM` | — |
| Review | koleksi `reviews` | — | — | — |
| Rekomendasi | — | — | query traversal | `rec:{tenantId}:{nim}` |
| Pencarian populer | — | koleksi `books` | — | `search:{hash}` |

### 4.3 Pola kunci Redis

| Kunci | Nilai | TTL | Kegunaan |
|---|---|---|---|
| `sess:{token}` | JSON sesi | 24 jam (86400 s) | Session login |
| `book:{tenantId}:{id}:stok` | integer | tidak ada | Cek & pengurangan stok atomik |
| `rec:{tenantId}:{nim}` | JSON array bookId | 6 jam (21600 s) | Cache hasil rekomendasi Neo4j |
| `search:{hash}` | JSON hasil pencarian | 10 menit (600 s) | Cache query populer |

Kunci `rec:` hanya dibuat bila traversal Neo4j menghasilkan rekomendasi. Pada data contoh, hanya `u-ub-01` yang di-cache rekomendasinya (`b-ub-03`, `b-ub-06`); tenant `unair` belum memilikinya karena belum ada pola pinjaman yang menghasilkan rekomendasi.

---

## 5. Struktur File

```
lit-app-db/
├── DOKUMENTASI.md                  ← dokumen ini
├── docker-compose.yml              ← 12 layanan versi lite (6 MongoDB, 4 Redis, 1 Typesense, 1 Neo4j)
├── .env.example                    ← contoh variabel lingkungan
├── .gitattributes                  ← memaksa akhir baris LF (penting di Windows)
└── scripts/
    ├── run-all.sh                  ← orkestrasi seluruh langkah
    ├── verify.sh                   ← verifikasi isi keempat database
    ├── mongo/
    │   ├── 01-init-cluster.js      ← inisiasi replica set
    │   ├── 02-init-sharding.js     ← shard, validator, index, zona tenant
    │   └── 03-seed.js              ← data contoh
    ├── typesense/
    │   ├── schema-books.json       ← definisi koleksi
    │   ├── books.jsonl             ← data contoh proyeksi
    │   └── seed.sh                 ← buat koleksi + impor
    ├── neo4j/
    │   ├── seed.cypher             ← constraint, node, relasi
    │   └── queries.cypher          ← contoh query rekomendasi
    └── redis/
        └── seed.sh                 ← isi session, stok, cache per shard
```

---

## 6. Langkah Lengkap Menjalankan

### 6.1 Prasyarat

- Docker Engine 24+ / Docker Desktop dengan Docker Compose v2
- `curl`, `bash` (di Windows: jalankan dari **Git Bash**)
- RAM kosong ±2 GB
- Port bebas: `27017`, `7474`, `7687`, `18108`

Salin contoh environment (opsional, untuk mengganti kredensial):

```bash
cp .env.example .env
```

### 6.2 Jalankan semuanya (cara disarankan)

```bash
cd lit-app-db
bash scripts/run-all.sh
```

Skrip melakukan delapan langkah: menyalakan kontainer, menunggu `mongod`, inisiasi replica set, inisiasi shard + skema, seed MongoDB, seed Typesense, seed Neo4j, seed Redis.

### 6.3 Jalankan manual (langkah per langkah)

Gunakan ini jika ingin melihat tiap tahap.

**Langkah 1 — Nyalakan kontainer**

```bash
docker compose up -d
docker compose ps
```

**Langkah 2 — Inisiasi replica set**

```bash
docker compose exec -T mongos mongosh --quiet --file /scripts/01-init-cluster.js
```

Tunggu sampai ketiga replica set memiliki primary:

```bash
docker compose exec -T shard1p mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState'
docker compose exec -T shard2p mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState'
docker compose exec -T cfg1 mongosh --quiet --eval 'db.adminCommand({replSetGetStatus:1}).myState'
```

> Di Git Bash (Windows), jalankan `export MSYS_NO_PATHCONV=1` dulu sebelum perintah manual yang memakai path `/scripts/...` atau `/var/lib/...`. `run-all.sh` dan `verify.sh` sudah melakukannya sendiri.

Nilai `1` berarti PRIMARY.

**Langkah 3 — Daftarkan shard, buat validator & index, shard koleksi**

```bash
docker compose exec -T mongos mongosh --quiet --file /scripts/02-init-sharding.js
```

Cek topologi dan zona:

```bash
docker compose exec -T mongos mongosh --quiet --eval 'sh.status()'
```

**Langkah 4 — Isi MongoDB**

```bash
docker compose exec -T mongos mongosh --quiet --file /scripts/03-seed.js
```

**Langkah 5 — Isi Typesense**

```bash
bash scripts/typesense/seed.sh
```

Contoh pencarian (typo tolerance + filter tenant):

```bash
curl -G 'http://localhost:18108/collections/books/documents/search' \
  -H 'X-TYPESENSE-API-KEY: litapp-secret' \
  --data-urlencode 'q=basis data nosql' \
  --data-urlencode 'query_by=judul,pengarang' \
  --data-urlencode 'filter_by=tenantId:=ub' \
  --data-urlencode 'facet_by=kategori,tipe' \
  --data-urlencode 'num_typos=2'
```

Salah ketik sengaja juga tetap cocok:

```bash
curl -G 'http://localhost:18108/collections/books/documents/search' \
  -H 'X-TYPESENSE-API-KEY: litapp-secret' \
  --data-urlencode 'q=basiss data nosq' \
  --data-urlencode 'query_by=judul' \
  --data-urlencode 'num_typos=2'
```

**Langkah 6 — Isi Neo4j**

```bash
docker compose exec -T neo4j cypher-shell -u neo4j -p litapp-pass \
  --file /var/lib/neo4j/import/seed.cypher
```

Jalankan query rekomendasi:

```bash
docker compose exec -T neo4j cypher-shell -u neo4j -p litapp-pass \
  --file /var/lib/neo4j/import/queries.cypher
```

**Langkah 7 — Isi Redis**

```bash
bash scripts/redis/seed.sh
```

**Langkah 8 — Verifikasi**

```bash
bash scripts/verify.sh
```

### 6.4 Hasil yang diharapkan

```
MongoDB (mongos, sharded):
PASS users = 9
PASS books = 9
PASS loans = 9
PASS reviews = 4
MongoDB (sebaran tenant per shard, dibaca langsung dari tiap shard):
PASS shard1 primary: buku ub = 6
PASS shard1 primary: buku unair = 0
PASS shard2 primary: buku unair = 3
PASS shard1 secondary (replika): buku ub = 6
PASS shard2 secondary (replika): buku unair = 3
Typesense:
PASS books indexed = 9
Neo4j:
PASS User nodes = 9
PASS Book nodes = 9
PASS Category nodes = 14
PASS PINJAM edges = 9
Redis:
PASS stok ub b-ub-01 = 5
PASS TTL sesi ub = 86400
PASS stok unair b-unair-01 = 6
PASS slave s1 menyalin stok ub = 5
SEMUA PASS
```

Neo4j Browser tersedia di `http://localhost:7474` (user `neo4j`, password `litapp-pass`). Typesense health: `http://localhost:18108/health`.

### 6.5 Mematikan

```bash
docker compose down      # data tetap tersimpan di volume
docker compose down -v   # data ikut dihapus, mulai dari nol
```

---

## 7. Detail per Database

### 7.1 MongoDB

**Database:** `litapp`. **Shard key:** `{tenantId, <entityId>}` pada keempat koleksi.

Contoh dokumen buku (skema fleksibel — `metadata_spesifik` berbeda per `tipe`):

```json
{
  "_id": ObjectId("..."),
  "tenantId": "ub",
  "bookId": "b-ub-01",
  "judul": "Basis Data NoSQL",
  "tipe": "buku_teks",
  "pengarang": "Rina Safitri",
  "kategori": ["Basis Data", "Teknologi"],
  "metadata_spesifik": { "halaman": 320, "penerbit": "Informatika", "isbn": "978-979-1234-01-1" },
  "stok": 5,
  "tersedia": true,
  "tahun": 2023
}
```

```json
{
  "_id": ObjectId("..."),
  "tenantId": "ub",
  "bookId": "b-ub-02",
  "judul": "Sistem Rekomendasi",
  "tipe": "skripsi",
  "metadata_spesifik": { "pembimbing": "Bu Rina", "abstrak": "..." }
}
```

Dua dokumen dengan `tipe` berbeda hidup di satu koleksi tanpa kolom NULL — ini alasan document model dipilih.

**Validator:** setiap koleksi memakai `$jsonSchema` dengan `validationLevel: "strict"`. Field wajib dan enum didefinisikan di `02-init-sharding.js`.

**Index:**

| Koleksi | Index | Unik |
|---|---|---|
| `users` | `{tenantId:1, userId:1}` | ya |
| `users` | `{tenantId:1, nim:1}` | tidak |
| `books` | `{tenantId:1, bookId:1}` | ya |
| `books` | `{tenantId:1, tipe:1}` | tidak |
| `books` | `{tenantId:1, kategori:1}` | tidak |
| `loans` | `{tenantId:1, loanId:1}` | ya |
| `loans` | `{tenantId:1, userId:1}`, `{tenantId:1, bookId:1}` | tidak |
| `reviews` | `{tenantId:1, reviewId:1}` | ya |
| `reviews` | `{tenantId:1, bookId:1}` | tidak |

**Query contoh:**

```javascript
use litapp

db.books.find({ tenantId: "ub", tipe: "buku_teks" })
db.books.find({ tenantId: "ub", kategori: "Basis Data" })

db.loans.find({ tenantId: "ub", userId: "u-ub-01", status: "dipinjam" })

db.reviews.aggregate([
  { $match: { bookId: "b-ub-01" } },
  { $group: { _id: "$bookId", avgRating: { $avg: "$rating" }, jumlah: { $sum: 1 } } }
])

db.users.aggregate([
  { $match: { tenantId: "ub" } },
  { $lookup: {
      from: "reviews",
      let: { uid: "$userId" },
      pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$uid"] } } }],
      as: "reviewSaya"
  } }
])
```

> `$lookup` lintas shard tetap didukung, tetapi untuk pola baca utama agregat diambil lewat `bookId`/`userId` (sudah mengandung shard key) agar tetap murah.

**Operasi pinjam/kembali (konsep):**

```javascript
db.loans.insertOne({
  tenantId: "ub", loanId: "l-baru", userId: "u-ub-01", bookId: "b-ub-01",
  tglPinjam: new Date(), batasKembali: new Date(Date.now() + 14*86400000),
  status: "dipinjam"
});
db.books.updateOne(
  { tenantId: "ub", bookId: "b-ub-01", stok: { $gt: 0 } },
  { $inc: { stok: -1 } }
);
```

Pengurangan stok yang sangat sering dilakukan di Redis (§7.4), lalu MongoDB disinkronkan berkala.

### 7.2 Typesense

**Koleksi:** `books`, proyeksi read-only dari `litapp.books`.

Skema lengkap ada di `scripts/typesense/schema-books.json`:

| Field | Tipe | Facet | Catatan |
|---|---|---|---|
| `id` | string | tidak | Sama dengan `bookId` MongoDB |
| `tenantId` | string | ya | Filter wajib untuk isolasi tenant |
| `judul` | string | tidak | Di-search (`query_by`) |
| `pengarang` | string | tidak | Di-search |
| `kategori` | string[] | ya | Filter/facet |
| `tipe` | string | ya | Filter/facet |
| `tahun` | int32 | ya | `default_sorting_field` |
| `metadata_spesifik` | string | tidak | JSON terserialisasi, `index:false` |

Typo tolerance, autocomplete, ranking, dan faceting bawaan Typesense. B-Tree SQL dengan `LIKE %...%` tidak dapat melakukan ini secara efisien.

Contoh permintaan:

```bash
# Autocomplete prefiks
curl -G 'http://localhost:18108/collections/books/documents/search' \
  -H 'X-TYPESENSE-API-KEY: litapp-secret' \
  --data-urlencode 'q=algo' \
  --data-urlencode 'query_by=judul' \
  --data-urlencode 'prefix=true,true' \
  --data-urlencode 'filter_by=tenantId:=ub'

# Faceting
curl -G 'http://localhost:18108/collections/books/documents/search' \
  -H 'X-TYPESENSE-API-KEY: litapp-secret' \
  --data-urlencode 'q=*' \
  --data-urlencode 'query_by=judul' \
  --data-urlencode 'facet_by=tipe,kategori' \
  --data-urlencode 'filter_by=tenantId:=ub'
```

Cek kesehatan node:

```bash
curl -s http://localhost:18108/health
```

### 7.3 Neo4j

**Model graph:**

```
(:User)-[:PINJAM {loanId, tenantId, tglPinjam, status}]->(:Book)
(:Book)-[:BERKATEGORI]->(:Category)
```

Constraint: `User.userId`, `Book.bookId`, `Category.nama` unik.

Query rekomendasi collaborative filtering (dari presentasi, dengan filter tenant):

```cypher
MATCH (saya:User {userId:'u-ub-01', tenantId:'ub'})-[:PINJAM]->(:Book)<-[:PINJAM]-(mirip:User {tenantId:'ub'})-[:PINJAM]->(rekom:Book {tenantId:'ub'})
WHERE NOT (saya)-[:PINJAM]->(rekom)
RETURN rekom.bookId AS bookId, rekom.judul AS judul, count(DISTINCT mirip) AS skor
ORDER BY skor DESC
LIMIT 10;
```

Dengan data contoh, `u-ub-01` (Faza), `u-ub-02` (Husein), dan `u-ub-06` (Reinhard) sama-sama meminjam `b-ub-01`. Husein juga meminjam `b-ub-03` dan Reinhard meminjam `b-ub-06`, yang belum dipinjam Faza — maka `b-ub-03` dan `b-ub-06` menjadi rekomendasi untuk Faza. Ini menggantikan self-join bertingkat yang mahal di SQL/document.

Traversal dibatasi maksimal dua hop dari pengguna ke pengguna serupa. Hasil query disimpan di Redis sebagai `rec:{tenantId}:{nim}` dengan TTL 6 jam agar query graph tidak diulang terus-menerus.

### 7.4 Redis

Peta shard: tenant `ub` → `redis-s1m`, tenant `unair` → `redis-s2m`.

```bash
docker compose exec -T redis-s1m redis-cli SET "book:ub:b-ub-01:stok" 5
docker compose exec -T redis-s1m redis-cli DECR "book:ub:b-ub-01:stok"
docker compose exec -T redis-s1m redis-cli TTL "rec:ub:245150700111044"
```

Pengurangan stok atomik memakai `DECR` (operasi tunggal, aman untuk konkurensi). Pola yang dipakai aplikasi: `DECR` → jika hasil ≥ 0, lanjut buat `Loan` di MongoDB; jika < 0, `INCR` kembali dan tolak karena stok habis.

Contoh Lua untuk operasi "cek dan kurangi" sekaligus:

```bash
docker compose exec -T redis-s1m redis-cli EVAL \
  "local n=tonumber(redis.call('GET',KEYS[1])); if n<=0 then return -1 end; return redis.call('DECR',KEYS[1])" \
  1 "book:ub:b-ub-01:stok"
```

Replikasi dicek dengan:

```bash
docker compose exec -T redis-s1s redis-cli INFO replication
docker compose exec -T redis-s1s redis-cli GET "book:ub:b-ub-01:stok"   # nilai sama dengan master
docker compose exec -T redis-s1s redis-cli SET coba 1                   # ditolak: READONLY
```

---

## 8. Isi Data Contoh

### 8.1 Tenant

| tenantId | Nama | Shard | Redis master |
|---|---|---|---|
| `ub` | Universitas Brawijaya | `shard1` (`rs1`, `zona_ub`) | `redis-s1m` |
| `unair` | Universitas Airlangga | `shard2` (`rs2`, `zona_unair`) | `redis-s2m` |

### 8.2 User (9)

| userId | tenantId | NIM | Nama | role |
|---|---|---|---|---|
| u-ub-01 | ub | 245150700111044 | Muhammad Faza Husain Baihaqi | mahasiswa |
| u-ub-02 | ub | 245150707111040 | Husein Sidharta Muhammad | mahasiswa |
| u-ub-03 | ub | 198701010101001 | Bu Rina | dosen |
| u-ub-04 | ub | 198512312312001 | Pak Bagas | pustakawan |
| u-ub-05 | ub | 199003032003001 | Sinta Wulandari | admin |
| u-ub-06 | ub | 245150707111043 | Reinhard Frano Randalinggi | mahasiswa |
| u-unair-01 | unair | 231510700111001 | Andi Pratama | mahasiswa |
| u-unair-02 | unair | 231510707111002 | Nadia Putri | mahasiswa |
| u-unair-03 | unair | 198802022002001 | Dr. Dewi | dosen |

### 8.3 Book (9)

| bookId | tenantId | Judul | tipe | stok | tahun |
|---|---|---|---|---|---|
| b-ub-01 | ub | Basis Data NoSQL | buku_teks | 5 | 2023 |
| b-ub-02 | ub | Sistem Rekomendasi | skripsi | 1 | 2024 |
| b-ub-03 | ub | Laskar Pelangi | novel | 8 | 2005 |
| b-ub-04 | ub | Jurnal Sistem Informasi Vol. 12 | jurnal | 3 | 2025 |
| b-ub-05 | ub | Python untuk Analisis Data | ebook | 20 | 2024 |
| b-ub-06 | ub | Algoritma dan Struktur Data | buku_teks | 4 | 2022 |
| b-unair-01 | unair | Basis Data Relasional | buku_teks | 6 | 2023 |
| b-unair-02 | unair | Manajemen Perpustakaan Digital | buku_teks | 3 | 2024 |
| b-unair-03 | unair | Sejarah Indonesia | buku_teks | 7 | 2020 |

Kategori unik di Neo4j: 14 node (Basis Data, Teknologi, Kecerdasan Buatan, Skripsi, Fiksi, Novel, Jurnal, Sistem Informasi, Pemrograman, Data, Algoritma, Perpustakaan, Manajemen, Sejarah).

### 8.4 Loan (9)

| loanId | tenant | user | book | status |
|---|---|---|---|---|
| l-ub-01 | ub | u-ub-01 | b-ub-01 | dikembalikan |
| l-ub-02 | ub | u-ub-01 | b-ub-02 | dipinjam |
| l-ub-03 | ub | u-ub-02 | b-ub-01 | terlambat |
| l-ub-04 | ub | u-ub-02 | b-ub-03 | dipinjam |
| l-ub-05 | ub | u-ub-03 | b-ub-04 | dipinjam |
| l-ub-06 | ub | u-ub-06 | b-ub-01 | dikembalikan |
| l-ub-07 | ub | u-ub-06 | b-ub-06 | dipinjam |
| l-unair-01 | unair | u-unair-01 | b-unair-01 | dikembalikan |
| l-unair-02 | unair | u-unair-02 | b-unair-01 | dipinjam |

### 8.5 Review (4)

| reviewId | tenant | user | book | rating |
|---|---|---|---|---|
| r-ub-01 | ub | u-ub-01 | b-ub-01 | 5 |
| r-ub-02 | ub | u-ub-02 | b-ub-01 | 4 |
| r-ub-03 | ub | u-ub-03 | b-ub-03 | 5 |
| r-unair-01 | unair | u-unair-01 | b-unair-01 | 4 |

### 8.6 Redis keys seeds

| Kunci shard | Nilai ringkas | TTL |
|---|---|---|
| `sess:token-ub-01` | sesi u-ub-01 | 86400 |
| `sess:token-ub-02` | sesi u-ub-02 | 86400 |
| `book:ub:b-ub-01:stok` | 5 | — |
| `book:ub:b-ub-02:stok` | 1 | — |
| `book:ub:b-ub-03:stok` | 8 | — |
| `rec:ub:245150700111044` | `["b-ub-03","b-ub-06"]` | 21600 |
| `search:a1b2c3` | hasil pencarian "basis data" | 600 |
| `sess:token-unair-01` | sesi u-unair-01 | 86400 |
| `book:unair:b-unair-01:stok` | 6 | — |
| `book:unair:b-unair-02:stok` | 3 | — |
| `search:d4e5f6` | hasil pencarian "manajemen" | 600 |

---

## 9. Sinkronisasi & Konsistensi

```
             tulis katalog / pinjam
                     │
                     ▼
                MongoDB (source of truth)
                     │  change stream / event (konsep)
          ┌──────────┼───────────────┐
          ▼          ▼               ▼
     Typesense     Neo4j          Redis
   (indeks teks)  (graph relasi)  (cache stok/sesi)
     eventual       eventual        TTL-based
    beberapa       beberapa      nonce / invalidate
      detik          detik
```

- MongoDB adalah satu-satunya sumber kebenaran. Typesense dan Neo4j adalah proyeksi.
- Typesense bersifat asinkron beberapa detik; indeks bisa dibangun ulang dari MongoDB kapan pun tanpa kehilangan data asli.
- Neo4j menyimpan hanya relasi pinjaman dan kategori; bila datanya hilang, dibangun ulang dari koleksi `loans` dan `books`.
- Redis bersifat cache: bisa diisi ulang dari MongoDB/Neo4j. Stok di Redis adalah nilai kerja;MongoDB tetap menjadi pencatatan final setelah transaksi selesai.
- Isolasi tenant dijaga di semua layer dengan menyertakan `tenantId` pada filter dan kunci.

---

## 10. Backup & Restore

```bash
# MongoDB (sharded): dump lewat mongos
docker compose exec -T mongos mongodump --host mongos --port 27017 \
  --db litapp --out /tmp/dump
docker compose cp mongos:/tmp/dump ./backup-mongo

# Restore
docker compose cp ./backup-mongo mongos:/tmp/dump
docker compose exec -T mongos mongorestore --host mongos --port 27017 /tmp/dump

# Neo4j Community: dump hanya boleh saat DBMS offline (STOP DATABASE hanya Enterprise)
docker compose stop neo4j
docker run --rm -v lit-app-db_neo4j-data:/data neo4j:5.20-community \
  neo4j-admin database dump neo4j --to-path=/data
docker compose cp neo4j:/data/neo4j.dump ./backup-neo4j.dump
docker compose start neo4j

# Redis: AOF sudah aktif (appendonly yes); salin direktori data volume
# Typesense: tidak perlu backup terpisah — indeks dibangun ulang dari MongoDB
```

---

## 11. Troubleshooting

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `mongos` error "not yet primary" saat addShard | Replica set belum selesai pemilihan primary | Tunggu `myState === 1`, ulangi `02-init-sharding.js` |
| `sh.status()` belum menampilkan shard | addShard gagal saat config RS belum siap | Ulangi langkah 3 setelah `cfg1` primary |
| `$'\r': command not found` saat menjalankan skrip | Clone lama sebelum ada `.gitattributes`, skrip berakhir baris CRLF | `git rm --cached -r . && git reset --hard` |
| Error path `C:/Program Files/Git/...` | Git Bash mengubah path Linux | `export MSYS_NO_PATHCONV=1` |
| `sh.status()` semua chunk di satu shard | Zona belum terpasang | Jalankan ulang `02-init-sharding.js` pada database kosong |
| Kontainer Mongo mati, log menyebut AVX | CPU tidak mendukung AVX (syarat MongoDB 5+) | Ganti image ke `mongo:4.4` |
| `curl` Typesense 401 | API key beda dengan `--api-key` di compose | Set `TYPESENSE_API_KEY` sesuai `.env` |
| Neo4j `cypher-shell` gagal login | Password beda dengan `NEO4J_AUTH` | Set `NEO4J_PASSWORD` sesuai `.env` |
| Redis slave tidak menyalin | `replicaof` salah nama host | Pastikan `redis-s1m` / `redis-s2m` sesuai `command` |
| `verify.sh` FAIL jumlah doc | Seed belum jalan atau seed gagal di tengah | Ulangi seed yang bersangkutan lalu verifikasi |

---

## 12. Catatan Keamanan & Keterbatasan

- Kontainer MongoDB berjalan **tanpa autentikasi internal** karena berada di network Docker privat. Untuk produksi, aktifkan `security.keyFile` di semua `mongod`/`mongos` dan buat pengguna admin.
- API key Typesense dan password Neo4j di sini adalah nilai contoh. Simpan di `.env` (gitignored) dan gunakan secret manager untuk produksi.
- Versi lite: config server 1 node dan 2 anggota per shard, sehingga tidak ada failover otomatis (lihat §3.5).
- Pipeline sinkronisasi MongoDB → Typesense/Neo4j dijelaskan sebagai konsep; implementasi change-stream produksi tidak termasuk cakupan layer database ini.

---

## 13. Rangkuman Perintah

```bash
cd lit-app-db
cp .env.example .env              # opsional
bash scripts/run-all.sh           # nyalakan + init + seed semua
bash scripts/verify.sh            # cek isi keempat database

# akses
# MongoDB   : mongosh mongodb://localhost:27017/litapp
# Typesense : http://localhost:18108/health
# Neo4j     : http://localhost:7474  (neo4j / litapp-pass)
# Redis     : docker compose exec -T redis-s1m redis-cli
```

Akhir dokumen.
