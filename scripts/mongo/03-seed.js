const router = connect("mongodb://mongos:27017");
const db = router.getSiblingDB("litapp");

const users = [
  { tenantId: "ub", userId: "u-ub-01", nim: "245150700111044", nama: "Muhammad Faza Husain Baihaqi", role: "mahasiswa", prodi: "Teknik Informatika", angkatan: 2024, email: "faza@ub.ac.id" },
  { tenantId: "ub", userId: "u-ub-02", nim: "245150707111040", nama: "Husein Sidharta Muhammad", role: "mahasiswa", prodi: "Teknik Informatika", angkatan: 2024, email: "husein@ub.ac.id" },
  { tenantId: "ub", userId: "u-ub-03", nim: "198701010101001", nama: "Bu Rina", role: "dosen", prodi: "Teknik Informatika", angkatan: 1987, email: "rina@ub.ac.id" },
  { tenantId: "ub", userId: "u-ub-04", nim: "198512312312001", nama: "Pak Bagas", role: "pustakawan", prodi: "Perpustakaan", angkatan: 1985, email: "bagas@ub.ac.id" },
  { tenantId: "ub", userId: "u-ub-05", nim: "199003032003001", nama: "Sinta Wulandari", role: "admin", prodi: "Sistem Informasi", angkatan: 1990, email: "sinta@ub.ac.id" },
  { tenantId: "ub", userId: "u-ub-06", nim: "245150707111043", nama: "Reinhard Frano Randalinggi", role: "mahasiswa", prodi: "Teknik Informatika", angkatan: 2024, email: "reinhard@ub.ac.id" },
  { tenantId: "unair", userId: "u-unair-01", nim: "231510700111001", nama: "Andi Pratama", role: "mahasiswa", prodi: "Teknik Informatika", angkatan: 2023, email: "andi@unair.ac.id" },
  { tenantId: "unair", userId: "u-unair-02", nim: "231510707111002", nama: "Nadia Putri", role: "mahasiswa", prodi: "Sistem Informasi", angkatan: 2023, email: "nadia@unair.ac.id" },
  { tenantId: "unair", userId: "u-unair-03", nim: "198802022002001", nama: "Dr. Dewi", role: "dosen", prodi: "Perpustakaan", angkatan: 1988, email: "dewi@unair.ac.id" }
];

const books = [
  { tenantId: "ub", bookId: "b-ub-01", judul: "Basis Data NoSQL", tipe: "buku_teks", pengarang: "Rina Safitri", kategori: ["Basis Data", "Teknologi"], metadata_spesifik: { halaman: 320, penerbit: "Informatika", isbn: "978-979-1234-01-1" }, stok: 5, tersedia: true, tahun: 2023 },
  { tenantId: "ub", bookId: "b-ub-02", judul: "Sistem Rekomendasi", tipe: "skripsi", pengarang: "Faza Husain", kategori: ["Kecerdasan Buatan", "Skripsi"], metadata_spesifik: { pembimbing: "Bu Rina", abstrak: "Rancangan sistem rekomendasi berbasis graph collaborative filtering." }, stok: 1, tersedia: true, tahun: 2024 },
  { tenantId: "ub", bookId: "b-ub-03", judul: "Laskar Pelangi", tipe: "novel", pengarang: "Andrea Hirata", kategori: ["Fiksi", "Novel"], metadata_spesifik: { halaman: 529, penerbit: "Bentang Pustaka" }, stok: 8, tersedia: true, tahun: 2005 },
  { tenantId: "ub", bookId: "b-ub-04", judul: "Jurnal Sistem Informasi Vol. 12", tipe: "jurnal", pengarang: "Fakultas Ilmu Komputer", kategori: ["Jurnal", "Sistem Informasi"], metadata_spesifik: { edisi: "Vol. 12", penerbit: "FILKOM UB" }, stok: 3, tersedia: true, tahun: 2025 },
  { tenantId: "ub", bookId: "b-ub-05", judul: "Python untuk Analisis Data", tipe: "ebook", pengarang: "Andi Pratama", kategori: ["Pemrograman", "Data"], metadata_spesifik: { format: "PDF", ukuran_mb: 14.2 }, stok: 20, tersedia: true, tahun: 2024 },
  { tenantId: "ub", bookId: "b-ub-06", judul: "Algoritma dan Struktur Data", tipe: "buku_teks", pengarang: "Rinaldi Munir", kategori: ["Pemrograman", "Algoritma"], metadata_spesifik: { halaman: 412, penerbit: "Informatika" }, stok: 4, tersedia: true, tahun: 2022 },
  { tenantId: "unair", bookId: "b-unair-01", judul: "Basis Data Relasional", tipe: "buku_teks", pengarang: "Dewi Anggraini", kategori: ["Basis Data", "Teknologi"], metadata_spesifik: { halaman: 288, penerbit: "Andi Offset" }, stok: 6, tersedia: true, tahun: 2023 },
  { tenantId: "unair", bookId: "b-unair-02", judul: "Manajemen Perpustakaan Digital", tipe: "buku_teks", pengarang: "Dewi Anggraini", kategori: ["Perpustakaan", "Manajemen"], metadata_spesifik: { halaman: 210, penerbit: "Andi Offset" }, stok: 3, tersedia: true, tahun: 2024 },
  { tenantId: "unair", bookId: "b-unair-03", judul: "Sejarah Indonesia", tipe: "buku_teks", pengarang: "Sartono Kartodirdjo", kategori: ["Sejarah"], metadata_spesifik: { halaman: 356, penerbit: "Gramedia" }, stok: 7, tersedia: true, tahun: 2020 }
];

const loans = [
  { tenantId: "ub", loanId: "l-ub-01", userId: "u-ub-01", bookId: "b-ub-01", tglPinjam: ISODate("2026-11-01T08:00:00Z"), batasKembali: ISODate("2026-11-15T08:00:00Z"), tglDikembalikan: ISODate("2026-11-14T09:30:00Z"), status: "dikembalikan" },
  { tenantId: "ub", loanId: "l-ub-02", userId: "u-ub-01", bookId: "b-ub-02", tglPinjam: ISODate("2026-11-02T10:15:00Z"), batasKembali: ISODate("2026-11-16T10:15:00Z"), status: "dipinjam" },
  { tenantId: "ub", loanId: "l-ub-03", userId: "u-ub-02", bookId: "b-ub-01", tglPinjam: ISODate("2026-10-20T13:00:00Z"), batasKembali: ISODate("2026-11-03T13:00:00Z"), tglDikembalikan: ISODate("2026-11-05T08:00:00Z"), status: "terlambat" },
  { tenantId: "ub", loanId: "l-ub-04", userId: "u-ub-02", bookId: "b-ub-03", tglPinjam: ISODate("2026-11-05T07:45:00Z"), batasKembali: ISODate("2026-11-19T07:45:00Z"), status: "dipinjam" },
  { tenantId: "ub", loanId: "l-ub-05", userId: "u-ub-03", bookId: "b-ub-04", tglPinjam: ISODate("2026-11-10T11:00:00Z"), batasKembali: ISODate("2026-11-24T11:00:00Z"), status: "dipinjam" },
  { tenantId: "ub", loanId: "l-ub-06", userId: "u-ub-06", bookId: "b-ub-01", tglPinjam: ISODate("2026-11-04T09:00:00Z"), batasKembali: ISODate("2026-11-18T09:00:00Z"), tglDikembalikan: ISODate("2026-11-12T10:00:00Z"), status: "dikembalikan" },
  { tenantId: "ub", loanId: "l-ub-07", userId: "u-ub-06", bookId: "b-ub-06", tglPinjam: ISODate("2026-11-12T10:30:00Z"), batasKembali: ISODate("2026-11-26T10:30:00Z"), status: "dipinjam" },
  { tenantId: "unair", loanId: "l-unair-01", userId: "u-unair-01", bookId: "b-unair-01", tglPinjam: ISODate("2026-11-01T09:00:00Z"), batasKembali: ISODate("2026-11-15T09:00:00Z"), tglDikembalikan: ISODate("2026-11-14T16:00:00Z"), status: "dikembalikan" },
  { tenantId: "unair", loanId: "l-unair-02", userId: "u-unair-02", bookId: "b-unair-01", tglPinjam: ISODate("2026-11-03T14:20:00Z"), batasKembali: ISODate("2026-11-17T14:20:00Z"), status: "dipinjam" }
];

const reviews = [
  { tenantId: "ub", reviewId: "r-ub-01", userId: "u-ub-01", bookId: "b-ub-01", rating: 5, komentar: "Materi lengkap, sangat membantu skripsi saya.", tgl: ISODate("2026-11-14T10:00:00Z") },
  { tenantId: "ub", reviewId: "r-ub-02", userId: "u-ub-02", bookId: "b-ub-01", rating: 4, komentar: "Cukup bagus, sayang edisinya lama.", tgl: ISODate("2026-11-05T12:00:00Z") },
  { tenantId: "ub", reviewId: "r-ub-03", userId: "u-ub-03", bookId: "b-ub-03", rating: 5, komentar: "Bacaan ringan yang inspiratif.", tgl: ISODate("2026-11-06T15:30:00Z") },
  { tenantId: "unair", reviewId: "r-unair-01", userId: "u-unair-01", bookId: "b-unair-01", rating: 4, komentar: "Referensi yang solid untuk mata kuliah.", tgl: ISODate("2026-11-14T11:00:00Z") }
];

const collections = { users, books, loans, reviews };

for (const name of Object.keys(collections)) {
  const col = db.getCollection(name);
  col.deleteMany({});
  col.insertMany(collections[name]);
  print("SEED " + name + " -> " + col.countDocuments({}));
}

const perTenant = db.books.aggregate([
  { $group: { _id: "$tenantId", total: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray();
print("BOOKS per tenant -> " + JSON.stringify(perTenant));
