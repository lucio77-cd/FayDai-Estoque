// Adaptador mínimo em memória para testar os serviços sem acessar o Firebase real.
const records = new Map();
let sequence = 0;

export const db = { __mockFirestore: true };

export function collection(_db, name) {
  return { kind: "collection", name };
}

export function doc(base, collectionName, id) {
  if (base?.kind === "collection") {
    return { kind: "doc", collection: base.name, id: collectionName || `auto-${++sequence}` };
  }
  return { kind: "doc", collection: collectionName, id };
}

export function where(field, operator, value) {
  return { field, operator, value };
}

export function query(collectionRef, ...filters) {
  return { kind: "query", name: collectionRef.name, filters };
}

export function serverTimestamp() {
  return { __serverTimestamp: true };
}

export function arrayUnion(...values) {
  return { __arrayUnion: values };
}

function key(ref) {
  return `${ref.collection}/${ref.id}`;
}

function makeDocSnapshot(ref) {
  const exists = records.has(key(ref));
  const value = records.get(key(ref));
  return {
    id: ref.id,
    ref,
    exists: () => exists,
    data: () => value
  };
}

function makeQuerySnapshot(ref) {
  const name = ref.name;
  const filters = ref.filters || [];
  const docs = [...records.entries()]
    .filter(([recordKey]) => recordKey.startsWith(`${name}/`))
    .map(([recordKey, data]) => {
      const id = recordKey.slice(name.length + 1);
      return { id, ref: { kind: "doc", collection: name, id }, data };
    })
    .filter(({ data }) => filters.every((filter) => {
      const actual = data?.[filter.field];
      if (filter.operator === "==") return actual === filter.value;
      return false;
    }))
    .map(({ id, ref, data }) => ({ id, ref, data: () => data }));
  return { docs, empty: docs.length === 0, size: docs.length };
}

export async function runTransaction(_db, callback) {
  const writes = [];
  const transaction = {
    async get(ref) {
      return ref.kind === "doc" ? makeDocSnapshot(ref) : makeQuerySnapshot(ref);
    },
    set(ref, data, options = {}) {
      writes.push({ type: "set", ref, data, merge: Boolean(options.merge) });
    },
    update(ref, data) {
      writes.push({ type: "update", ref, data });
    },
    delete(ref) {
      writes.push({ type: "delete", ref });
    }
  };

  const result = await callback(transaction);
  for (const write of writes) {
    const recordKey = key(write.ref);
    if (write.type === "delete") {
      records.delete(recordKey);
    } else if (write.type === "update") {
      if (!records.has(recordKey)) throw new Error("Documento inexistente no mock.");
      records.set(recordKey, { ...records.get(recordKey), ...write.data });
    } else {
      const current = records.get(recordKey);
      records.set(recordKey, write.merge && current ? { ...current, ...write.data } : write.data);
    }
  }
  return result;
}

export async function addDoc(collectionRef, data) {
  const ref = doc(collectionRef);
  records.set(key(ref), data);
  return ref;
}

export function writeBatch() {
  const writes = [];
  return {
    set(ref, data, options = {}) { writes.push({ ref, data, merge: Boolean(options.merge) }); },
    async commit() {
      for (const write of writes) {
        const recordKey = key(write.ref);
        const current = records.get(recordKey);
        records.set(recordKey, write.merge && current ? { ...current, ...write.data } : write.data);
      }
    }
  };
}

export function resetMockDb() {
  records.clear();
  sequence = 0;
}

export function seedDoc(collectionName, id, data) {
  records.set(`${collectionName}/${id}`, data);
}

export function readDoc(collectionName, id) {
  return records.get(`${collectionName}/${id}`);
}

export function dumpCollection(collectionName) {
  return [...records.entries()]
    .filter(([recordKey]) => recordKey.startsWith(`${collectionName}/`))
    .map(([recordKey, data]) => ({
      id: recordKey.slice(collectionName.length + 1),
      data
    }));
}
