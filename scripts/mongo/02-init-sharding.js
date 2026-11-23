const router = connect("mongodb://mongos:27017");
const admin = router.getDB("admin");

function run(label, cmd) {
  const res = admin.runCommand(cmd);
  if (res.ok !== 1 && res.code !== 48 && res.code !== 20 && res.code !== 59) {
    throw new Error("FAIL " + label + " -> " + tojson(res));
  }
  print("OK " + label);
}

run("addShard rs1", { addShard: "rs1/shard1p:27017,shard1s1:27017", name: "shard1" });
run("addShard rs2", { addShard: "rs2/shard2p:27017,shard2s1:27017", name: "shard2" });
run("enableSharding litapp", { enableSharding: "litapp" });

const db = router.getDB("litapp");

const validators = {
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: ["tenantId", "userId", "nim", "nama", "role"],
      properties: {
        tenantId: { bsonType: "string" },
        userId: { bsonType: "string" },
        nim: { bsonType: "string" },
        nama: { bsonType: "string" },
        role: { enum: ["mahasiswa", "dosen", "admin", "pustakawan"] },
        prodi: { bsonType: "string" },
        angkatan: { bsonType: "int" },
        email: { bsonType: "string" }
      }
    }
  },
  books: {
    $jsonSchema: {
      bsonType: "object",
      required: ["tenantId", "bookId", "judul", "tipe", "stok", "kategori"],
      properties: {
        tenantId: { bsonType: "string" },
        bookId: { bsonType: "string" },
        judul: { bsonType: "string" },
        tipe: { enum: ["buku_teks", "skripsi", "novel", "jurnal", "ebook"] },
        pengarang: { bsonType: "string" },
        kategori: { bsonType: "array", items: { bsonType: "string" } },
        metadata_spesifik: { bsonType: "object" },
        stok: { bsonType: "int", minimum: 0 },
        tersedia: { bsonType: "bool" },
        tahun: { bsonType: "int" }
      }
    }
  },
  loans: {
    $jsonSchema: {
      bsonType: "object",
      required: ["tenantId", "loanId", "userId", "bookId", "tglPinjam", "status"],
      properties: {
        tenantId: { bsonType: "string" },
        loanId: { bsonType: "string" },
        userId: { bsonType: "string" },
        bookId: { bsonType: "string" },
        tglPinjam: { bsonType: "date" },
        batasKembali: { bsonType: "date" },
        tglDikembalikan: { bsonType: "date" },
        status: { enum: ["dipinjam", "dikembalikan", "terlambat"] }
      }
    }
  },
  reviews: {
    $jsonSchema: {
      bsonType: "object",
      required: ["tenantId", "reviewId", "userId", "bookId", "rating"],
      properties: {
        tenantId: { bsonType: "string" },
        reviewId: { bsonType: "string" },
        userId: { bsonType: "string" },
        bookId: { bsonType: "string" },
        rating: { bsonType: "int", minimum: 1, maximum: 5 },
        komentar: { bsonType: "string" },
        tgl: { bsonType: "date" }
      }
    }
  }
};

for (const name of Object.keys(validators)) {
  if (!db.getCollectionNames().includes(name)) {
    db.createCollection(name, { validator: validators[name], validationLevel: "strict" });
    print("CREATE " + name + " dengan validator");
  }
}

const indexes = {
  users: [
    { key: { tenantId: 1, userId: 1 }, opts: { unique: true, name: "uq_tenant_user" } },
    { key: { tenantId: 1, nim: 1 }, opts: { name: "ix_tenant_nim" } }
  ],
  books: [
    { key: { tenantId: 1, bookId: 1 }, opts: { unique: true, name: "uq_tenant_book" } },
    { key: { tenantId: 1, tipe: 1 }, opts: { name: "ix_tenant_tipe" } },
    { key: { tenantId: 1, kategori: 1 }, opts: { name: "ix_tenant_kategori" } }
  ],
  loans: [
    { key: { tenantId: 1, loanId: 1 }, opts: { unique: true, name: "uq_tenant_loan" } },
    { key: { tenantId: 1, userId: 1 }, opts: { name: "ix_tenant_user" } },
    { key: { tenantId: 1, bookId: 1 }, opts: { name: "ix_tenant_book" } }
  ],
  reviews: [
    { key: { tenantId: 1, reviewId: 1 }, opts: { unique: true, name: "uq_tenant_review" } },
    { key: { tenantId: 1, bookId: 1 }, opts: { name: "ix_tenant_book" } }
  ]
};

for (const name of Object.keys(indexes)) {
  for (const spec of indexes[name]) {
    db.getCollection(name).createIndex(spec.key, spec.opts);
  }
  print("INDEX " + name + " siap");
}

const shardKeys = {
  users: { tenantId: 1, userId: 1 },
  books: { tenantId: 1, bookId: 1 },
  loans: { tenantId: 1, loanId: 1 },
  reviews: { tenantId: 1, reviewId: 1 }
};

// Zona tenant: tiap kampus dikunci ke shard tertentu (ub -> shard1, unair -> shard2).
// Tanpa zona, MongoDB bebas menaruh data kampus mana pun di shard mana pun,
// dan dengan data sekecil ini semuanya akan menumpuk di satu shard.
const tenantZones = { ub: "shard1", unair: "shard2" };

for (const tenant of Object.keys(tenantZones)) {
  run("addShardToZone " + tenantZones[tenant] + " -> zona_" + tenant,
    { addShardToZone: tenantZones[tenant], zone: "zona_" + tenant });
}

for (const name of Object.keys(shardKeys)) {
  const ns = "litapp." + name;
  const idField = Object.keys(shardKeys[name])[1];

  // Rentang zona dipasang sebelum shardCollection agar chunk langsung dibuat di shard yang benar
  for (const tenant of Object.keys(tenantZones)) {
    run("zona " + ns + " " + tenant, {
      updateZoneKeyRange: ns,
      min: { tenantId: tenant, [idField]: MinKey },
      max: { tenantId: tenant, [idField]: MaxKey },
      zone: "zona_" + tenant
    });
  }

  const res = admin.runCommand({ shardCollection: ns, key: shardKeys[name] });
  if (res.ok !== 1 && res.code !== 20 && res.code !== 59) {
    throw new Error("FAIL shardCollection " + ns + " -> " + tojson(res));
  }
  print("SHARD " + ns + " -> " + tojson(shardKeys[name]));
}

print("CLUSTER siap");
