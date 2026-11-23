const cfgMembers = [
  { _id: 0, host: "cfg1:27017" }
];

const rs1Members = [
  { _id: 0, host: "shard1p:27017", priority: 2 },
  { _id: 1, host: "shard1s1:27017", priority: 1 }
];

const rs2Members = [
  { _id: 0, host: "shard2p:27017", priority: 2 },
  { _id: 1, host: "shard2s1:27017", priority: 1 }
];

function initiateIfNeeded(host, config) {
  const conn = connect("mongodb://" + host + ":27017");
  const hello = conn.getDB("admin").runCommand({ hello: 1 });
  if (hello.setName) {
    print("SKIP " + host + " sudah bagian dari " + hello.setName);
    return;
  }
  const res = conn.getDB("admin").runCommand({ replSetInitiate: config });
  print("INIT " + host + " -> " + tojson(res));
}

initiateIfNeeded("cfg1", { _id: "cfgRS", configsvr: true, members: cfgMembers });
initiateIfNeeded("shard1p", { _id: "rs1", members: rs1Members });
initiateIfNeeded("shard2p", { _id: "rs2", members: rs2Members });
