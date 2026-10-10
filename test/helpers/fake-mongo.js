'use strict';

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((entry) => matches(doc, entry));
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(doc[key]);
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc, update = {}) {
  const result = { ...doc };
  for (const [key, value] of Object.entries(update.$set || {})) result[key] = value;
  for (const [key, value] of Object.entries(update.$setOnInsert || {})) {
    if (!(key in result)) result[key] = value;
  }
  for (const key of Object.keys(update.$unset || {})) delete result[key];
  return result;
}

function createCollection() {
  const docs = [];
  const indexes = [];
  return {
    docs,
    indexes,
    async createIndex(spec, options = {}) {
      indexes.push({ spec, options });
      return options.name || Object.keys(spec).join('_');
    },
    async findOne(filter) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      const found = docs.filter((doc) => matches(doc, filter));
      return {
        async toArray() { return found.map((doc) => ({ ...doc })); },
        sort() { return this; }
      };
    },
    async updateOne(filter, update, options = {}) {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index >= 0) {
        docs[index] = applyUpdate(docs[index], update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        docs.push(applyUpdate({ ...filter }, update));
        return { matchedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async deleteOne(filter) {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      let deletedCount = 0;
      for (let index = docs.length - 1; index >= 0; index -= 1) {
        if (matches(docs[index], filter)) {
          docs.splice(index, 1);
          deletedCount += 1;
        }
      }
      return { deletedCount };
    },
    async bulkWrite(operations) {
      for (const operation of operations) {
        if (operation.updateOne) {
          const item = operation.updateOne;
          await this.updateOne(item.filter, item.update, { upsert: item.upsert });
        } else if (operation.deleteOne) {
          await this.deleteOne(operation.deleteOne.filter);
        }
      }
      return { ok: 1 };
    }
  };
}

function createFakeDb() {
  const collections = new Map();
  const commands = [];
  return {
    collections,
    commands,
    collection(name) {
      if (!collections.has(name)) collections.set(name, createCollection());
      return collections.get(name);
    },
    async command(command) {
      commands.push(command);
      return { ok: 1 };
    }
  };
}

module.exports = {
  matches,
  applyUpdate,
  createCollection,
  createFakeDb
};
