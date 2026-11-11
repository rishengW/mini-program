// 云环境内存 mock（B6 测试集共用，2026-11-11）
// 支持 where/doc/add/CAS 条件更新/runTransaction/uploadFile/downloadFile/getTempFileURL。
// 事务共享同一内存态（不做真实回滚——仅用于驱动业务逻辑与断言状态/报表产出）。
const crypto = require('crypto')

function makeMock() {
  const state = {}
  let autoId = 0
  const uploads = []
  const command = {
    in: v => ({ __op: 'in', vals: v || [] }),
    neq: v => ({ __op: 'neq', v }),
    lt: v => ({ __op: 'lt', v }),
    lte: v => ({ __op: 'lte', v }),
    gte: v => ({ __op: 'gte', v }),
    exists: v => ({ __op: 'exists', v }),
    or: q => ({ __op: 'or', queries: q || [] }),
    and: q => ({ __op: 'and', queries: q || [] }),
    inc: v => ({ __op: 'inc', v }),
    set: v => ({ __op: 'set', v }),
    push: v => ({ __op: 'push', v })
  }
  function getPathValues(obj, path) {
    const parts = path.split('.')
    function walk(cur, i) {
      if (i === parts.length) return [cur]
      if (Array.isArray(cur)) return cur.reduce((a, el) => a.concat(walk(el, i)), [])
      if (cur == null) return [undefined]
      return walk(cur[parts[i]], i + 1)
    }
    return walk(obj, 0)
  }
  function matchValue(values, expected) {
    if (expected && expected.__op) {
      switch (expected.__op) {
        case 'in': return values.some(v => expected.vals.includes(v))
        case 'neq': return values.every(v => v !== expected.v)
        case 'lt': return values.some(v => v !== undefined && v !== null && v < expected.v)
        case 'lte': return values.some(v => v !== undefined && v !== null && v <= expected.v)
        case 'gte': return values.some(v => v !== undefined && v !== null && v >= expected.v)
        case 'exists': return expected.v ? values.some(v => v !== undefined) : values.every(v => v === undefined)
        default: return false
      }
    }
    return values.some(v => v === expected)
  }
  function matches(doc, query) {
    if (!query) return true
    if (query.__op === 'or') return query.queries.some(q => matches(doc, q))
    if (query.__op === 'and') return query.queries.every(q => matches(doc, q))
    return Object.keys(query).every(k => matchValue(getPathValues(doc, k), query[k]))
  }
  function applyData(doc, data) {
    Object.keys(data).forEach(k => {
      const v = data[k]
      if (v && v.__op === 'inc') { doc[k] = (Number(doc[k]) || 0) + v.v; return }
      if (v && v.__op === 'set') { doc[k] = v.v; return }
      if (v && v.__op === 'push') {
        const arr = Array.isArray(doc[k]) ? doc[k] : (doc[k] = [])
        arr.push(v.v)
        return
      }
      doc[k] = v
    })
  }
  function ensure(name) { if (!state[name]) state[name] = []; return state[name] }

  function chain(coll, q) {
    let limitN = Infinity, skipN = 0
    const c = {
      limit(n) { limitN = n; return c },
      skip(n) { skipN = n; return c },
      orderBy() { return c },
      field() { return c },
      get: async () => ({ data: ensure(coll).filter(d => matches(d, q)).slice(skipN, skipN + limitN).map(d => ({ ...d })) }),
      count: async () => ({ total: ensure(coll).filter(d => matches(d, q)).length }),
      update: async ({ data }) => {
        let updated = 0
        ensure(coll).forEach(d => { if (matches(d, q)) { applyData(d, data); updated++ } })
        return { stats: { updated } }
      }
    }
    return c
  }

  function collection(name) {
    return {
      where: q => chain(name, q),
      doc: id => ({
        get: async () => ({ data: ensure(name).find(d => d._id === id) || null }),
        update: async ({ data }) => {
          const doc = ensure(name).find(d => d._id === id)
          if (!doc) return { stats: { updated: 0 } }
          applyData(doc, data)
          return { stats: { updated: 1 } }
        }
      }),
      add: async ({ data }) => {
        const doc = { ...data }
        if (!doc._id) doc._id = 'ID' + (++autoId)
        if (name === 'report_version_counter' && ensure(name).some(d => d._id === doc._id)) {
          throw new Error('duplicate counter')
        }
        ensure(name).push(doc)
        return { _id: doc._id }
      }
    }
  }

  const cloud = {
    init() {},
    DYNAMIC_CURRENT_ENV: 'test',
    database: () => ({
      command,
      serverDate: (opt) => new Date(Date.now() + ((opt && opt.offset) || 0)),
      collection,
      // runTransaction：共享内存态；tx.collection 与普通 collection 同接口，rollback 空操作
      runTransaction: async (fn) => fn({ collection, rollback: async () => {} })
    }),
    uploadFile: async ({ cloudPath, fileContent }) => {
      uploads.push({ cloudPath, content: fileContent.toString('utf-8') })
      return { fileID: 'mock://' + cloudPath }
    },
    downloadFile: async ({ fileID }) => ({
      fileContent: Buffer.from((uploads.find(u => 'mock://' + u.cloudPath === fileID) || {}).content || '', 'utf-8')
    }),
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map(f => ({ fileID: f, tempFileURL: 'mock://' + f }))
    }),
    deleteFile: async () => ({})
  }
  return { cloud, state, uploads }
}

function installModuleMock(mock) {
  const Module = require('module')
  const origLoad = Module._load
  Module._load = function (request) {
    if (request === 'wx-server-sdk') return mock.cloud
    return origLoad.apply(this, arguments)
  }
}

function makeUser(id, role, token, extra = {}) {
  const th = crypto.createHash('sha256').update(token).digest('hex')
  return {
    _id: 'u_' + id, user_id: id, name: id, role, status: 1,
    sessions: [{ token_hash: th, expires_at: new Date(Date.now() + 86400000).toISOString() }],
    ...extra
  }
}

module.exports = { makeMock, installModuleMock, makeUser }
