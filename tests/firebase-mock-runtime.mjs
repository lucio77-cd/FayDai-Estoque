// Adaptador em memória para testar os serviços sem acessar o Firebase real.
// É propositalmente ESTRITO: reproduz restrições do SDK web que um mock permissivo esconderia.
//  - transaction.get() só aceita DocumentReference (consulta/coleção falha, como no SDK web);
//  - todas as leituras da transação vêm antes de qualquer escrita;
//  - IDs de documento no formato __nome__ são reservados e rejeitados;
//  - valores undefined nos dados são rejeitados.
const records = new Map();
let sequence = 0;
let transactionQueue = Promise.resolve();

export const db = { __mockFirestore: true };

// Usuário "logado" falso: devolucoes.js lê auth.currentUser?.email ao cancelar ou devolver.
export const auth = { currentUser: { email: "teste@faydai.local" } };

export function collection(_db, name) {
  return { kind: "collection", name };
}

function assertValidDocId(id) {
  if (typeof id !== "string" || id === "" || id === "." || id === ".." || id.includes("/")) {
    throw new Error(`ID de documento inválido no Firestore: "${id}".`);
  }
  if (/^__.*__$/.test(id)) {
    throw new Error(`ID de documento reservado pelo Firestore (formato __nome__): "${id}".`);
  }
}

export function doc(base, collectionName, id) {
  if (base?.kind === "collection") {
    const finalId = collectionName === undefined ? `auto-${++sequence}` : collectionName;
    assertValidDocId(finalId);
    return { kind: "doc", collection: base.name, id: finalId };
  }
  assertValidDocId(id);
  return { kind: "doc", collection: collectionName, id };
}

export function where(field, operator, value) {
  return { type: "where", field, operator, value };
}

export function limit(count) {
  return { type: "limit", count };
}

export function query(collectionRef, ...constraints) {
  return { kind: "query", name: collectionRef.name, constraints };
}

function assertNoUndefined(value, path = "dados") {
  if (value === undefined) throw new Error(`Firestore não aceita undefined (${path}).`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
  else if (value && typeof value === "object" && !value.__serverTimestamp && !value.__arrayUnion) {
    for (const [name, item] of Object.entries(value)) assertNoUndefined(item, `${path}.${name}`);
  }
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
  const constraints = ref.constraints || [];
  const filters = constraints.filter((item) => item.type === "where");
  const limits = constraints.filter((item) => item.type === "limit");
  let docs = [...records.entries()]
    .filter(([recordKey]) => recordKey.startsWith(`${name}/`))
    .map(([recordKey, data]) => {
      const id = recordKey.slice(name.length + 1);
      return { id, ref: { kind: "doc", collection: name, id }, data };
    })
    .filter(({ data }) => filters.every((filter) => {
      const actual = data?.[filter.field];
      if (filter.operator === "==") return actual === filter.value;
      if (actual === undefined || actual === null) return false;
      if (filter.operator === ">=") return actual >= filter.value;
      if (filter.operator === ">") return actual > filter.value;
      if (filter.operator === "<=") return actual <= filter.value;
      if (filter.operator === "<") return actual < filter.value;
      return false;
    }))
    .map(({ id, ref, data }) => ({ id, ref, data: () => data }));
  if (limits.length) docs = docs.slice(0, limits[limits.length - 1].count);
  return { docs, empty: docs.length === 0, size: docs.length };
}

let getDocsHook = null;
// Permite simular uma alteração concorrente entre a leitura do histórico e a transação.
export function setGetDocsHook(hook) {
  getDocsHook = hook;
}

export async function getDoc(ref) {
  if (ref?.kind !== "doc") throw new TypeError("getDoc exige uma DocumentReference.");
  return makeDocSnapshot(ref);
}

export async function getDocs(ref) {
  if (ref?.kind !== "collection" && ref?.kind !== "query") throw new TypeError("getDocs exige coleção ou consulta.");
  const snapshot = makeQuerySnapshot(ref);
  if (getDocsHook) await getDocsHook(ref.name, ref);
  return snapshot;
}

export async function runTransaction(_db, callback) {
  const previousTransaction = transactionQueue;
  let releaseTransaction;
  transactionQueue = new Promise((resolve) => { releaseTransaction = resolve; });
  await previousTransaction;

  try {
    const writes = [];
    const transaction = {
    async get(ref) {
      // No SDK web, Transaction.get aceita apenas DocumentReference.
      if (ref?.kind !== "doc") throw new TypeError("Transaction.get só aceita DocumentReference (consultas e coleções não são permitidas).");
      if (writes.length) throw new Error("Todas as leituras da transação devem vir antes das escritas.");
      return makeDocSnapshot(ref);
    },
    set(ref, data, options = {}) {
      assertNoUndefined(data);
      writes.push({ type: "set", ref, data, merge: Boolean(options.merge) });
    },
    update(ref, data) {
      assertNoUndefined(data);
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
  } finally {
    releaseTransaction();
  }
}

export async function addDoc(collectionRef, data) {
  assertNoUndefined(data);
  const ref = doc(collectionRef);
  records.set(key(ref), data);
  return ref;
}

export function writeBatch() {
  const writes = [];
  return {
    set(ref, data, options = {}) { assertNoUndefined(data); writes.push({ ref, data, merge: Boolean(options.merge) }); },
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
  transactionQueue = Promise.resolve();
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
