MATCH (saya:User {userId:'u-ub-01', tenantId:'ub'})-[:PINJAM]->(:Book)<-[:PINJAM]-(mirip:User {tenantId:'ub'})-[:PINJAM]->(rekom:Book {tenantId:'ub'})
WHERE NOT (saya)-[:PINJAM]->(rekom)
RETURN rekom.bookId AS bookId, rekom.judul AS judul, count(DISTINCT mirip) AS skor
ORDER BY skor DESC
LIMIT 10;

MATCH (u:User {userId:'u-ub-01'})-[:PINJAM]->(b:Book)
RETURN b.bookId AS bookId, b.judul AS judul;

MATCH (b:Book {bookId:'b-ub-01'})-[:BERKATEGORI]->(c:Category)
RETURN c.nama AS kategori;
