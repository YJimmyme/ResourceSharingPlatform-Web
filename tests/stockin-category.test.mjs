import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const root = new URL('../supabase/functions/', import.meta.url)
const catalog = [
  { item_name: '糖', category: '調味料類', unit: '包', stock_type: 'HasExpiry' },
  { item_name: '糖果', category: '零食類', unit: '包', stock_type: 'HasExpiry' },
  { item_name: '砂糖', category: '食品', unit: '包', stock_type: 'HasExpiry' },
]

// 執行實際 Edge handler，替換網路/資料庫邊界；不呼叫真實 AI 或寫入庫存。
function harness(functionName, options = {}) {
  const writes = [], queries = [], rpcCalls = []
  let handler, prompt
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) },
    storage: { from: () => ({ download: async () => ({ data: new Blob(['image'], { type: 'image/jpeg' }) }) }) },
    from(table) {
      let inserted
      const query = {
        select() { return query },
        eq(key, value) { queries.push({ table, key, value }); return query },
        limit() { return query },
        insert(value) { inserted = value; writes.push(value); return query },
        single() { return query },
        maybeSingle() { return query },
        then(resolve, reject) {
          const data = {
            profiles: { id: 'test-user', is_active: true, role_name: 'Cadre', location_id: 1 },
            inventory_item_definition: options.definitions ?? catalog,
            catalog_synonym: [{ synonym: '水果軟糖', standard_name: '糖果' }],
            ai_stock_in_settings: { is_enabled: true, api_key: 'test-key', supports_image_input: true, supports_text_input: true },
            ai_stock_in_log: { id: 7, ...inserted },
          }[table]
          const error = options.catalogError && table === 'inventory_item_definition' ? { message: 'unavailable' } : null
          return Promise.resolve({ data: error ? null : data, error }).then(resolve, reject)
        },
      }
      return query
    },
    async rpc(name, params) { rpcCalls.push({ name, params }); return { data: { id: 8, category: params.p_category } } },
  }
  function load(path) {
    const exports = {}
    const code = ts.transpileModule(fs.readFileSync(new URL(path, root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, {
      exports, Response, Blob, Uint8Array, btoa,
      Deno: { env: { get: () => 'test' } },
      require(specifier) {
        if (specifier.includes('http/server')) return { serve: fn => { handler = fn } }
        if (specifier.includes('supabase-js')) return { createClient: () => client }
        if (specifier.endsWith('stockin-category.ts')) return load('_shared/stockin-category.ts')
        throw Error('Unexpected import: ' + specifier)
      },
      fetch: async (_url, request) => {
        prompt = JSON.parse(request.body).messages[0].content[0].text
        return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ name: options.name ?? '糖果', category: '食品', quantity: 1, unit: '包', inventory_type: 'expiring' }] }) } }] })
      },
    })
    return exports
  }
  load(functionName + '/index.ts')
  return {
    writes, queries, rpcCalls, get prompt() { return prompt },
    async call(body) {
      const response = await handler(new Request('http://test.local', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }))
      return { status: response.status, body: await response.json() }
    },
  }
}

test('LINE 照片辨識：目錄零食類覆蓋 AI 食品，回傳與待確認紀錄一致', async () => {
  const h = harness('ai-stockin-recognize')
  const r = await h.call({ locationId: 1, imagePath: 'test-user/photo.jpg' })
  assert.equal(r.body.success, true)
  assert.equal(r.body.logs[0].suggested_category, '零食類')
  assert.equal(h.writes[0].suggested_category, '零食類')
  assert.ok(h.prompt.includes('零食類'))
  assert.ok(h.queries.some(q => q.table === 'inventory_item_definition' && q.key === 'is_active' && q.value === true))
})
test('同義詞先轉成糖果，再採用庫存分類', async () => {
  const r = await harness('ai-stockin-recognize', { name: '水果軟糖' }).call({ locationId: 1, inputText: '水果軟糖' })
  assert.equal(r.body.logs[0].suggested_item_name, '糖果')
  assert.equal(r.body.logs[0].suggested_category, '零食類')
})
test('未知品項保留暫定分類，不把名稱包含糖的品項誤配', async () => {
  const r = await harness('ai-stockin-recognize', { name: '糖果禮盒' }).call({ locationId: 1, inputText: '糖果禮盒' })
  assert.equal(r.body.logs[0].suggested_category, '食品')
})
test('確認入庫重新讀目錄，舊辨識結果食品不能覆蓋新的零食類', async () => {
  const h = harness('ai-stockin-confirm')
  const r = await h.call({ locationId: 1, logId: 7, itemName: ' 糖果 ', category: '食品', quantity: 1, stockType: 'HasExpiry' })
  assert.equal(r.body.item.category, '零食類')
  assert.equal(h.rpcCalls[0].params.p_category, '零食類')
})
test('人工改品名為糖後，使用調味料類而不是原來分類', async () => {
  const h = harness('ai-stockin-confirm')
  await h.call({ locationId: 1, logId: 7, itemName: '糖', category: '零食類' })
  assert.equal(h.rpcCalls[0].params.p_category, '調味料類')
})
test('目錄查詢失敗時不靜默使用 AI 分類，也不寫庫存', async () => {
  for (const name of ['ai-stockin-recognize', 'ai-stockin-confirm']) {
    const h = harness(name, { catalogError: true })
    const r = await h.call({ locationId: 1, inputText: '糖果', itemName: '糖果', category: '食品' })
    assert.equal(r.body.success, false)
    assert.equal(h.writes.length, 0)
    assert.equal(h.rpcCalls.length, 0)
  }
})
test('同名有衝突分類時拒絕任意選一筆入庫', async () => {
  const h = harness('ai-stockin-confirm', { definitions: [...catalog, { item_name: '糖果', category: '其他' }] })
  const r = await h.call({ locationId: 1, itemName: '糖果', category: '食品' })
  assert.equal(r.body.success, false)
  assert.equal(h.rpcCalls.length, 0)
})
