const assert = require('assert');
const { createMockKV, makeContext, muteConsole } = require('./helpers');

const meta = (overrides = {}) => ({
  TimeStamp: 1710000000000, ListType: 'None', Label: 'None', liked: false,
  fileName: 'clip.mp4', fileSize: 2048, ...overrides,
});

function mockR2(keys) {
  const objects = new Set(keys);
  return {
    deleted: [],
    async delete(key) { this.deleted.push(key); objects.delete(key); },
    has(key) { return objects.has(key); },
  };
}

function post(body) {
  return new Request('https://example.com/api/manage/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('batch manage API (additive)', function () {
  let restore;
  beforeEach(function () { restore = muteConsole(); });
  afterEach(function () { restore(); });

  it('blocks several records in one request', async function () {
    const { onRequestPost } = await import('../functions/api/manage/batch.js');
    const img_url = createMockKV({ 'a.mp4': meta(), 'b.png': meta({ fileName: 'b.png' }) });
    const res = await onRequestPost(makeContext({ request: post({ action: 'block', ids: ['a.mp4', 'b.png'] }), env: { img_url } }));
    const data = JSON.parse(await res.text());
    assert.strictEqual(data.okCount, 2);
    assert.strictEqual(img_url.snapshot('a.mp4').metadata.ListType, 'Block');
    assert.strictEqual(img_url.snapshot('b.png').metadata.ListType, 'Block');
  });

  it('reports missing records without failing the others', async function () {
    const { onRequestPost } = await import('../functions/api/manage/batch.js');
    const img_url = createMockKV({ 'a.mp4': meta() });
    const res = await onRequestPost(makeContext({ request: post({ action: 'like', ids: ['a.mp4', 'nope.mp4'] }), env: { img_url } }));
    const data = JSON.parse(await res.text());
    assert.strictEqual(data.okCount, 1);
    assert.strictEqual(data.failCount, 1);
    assert.strictEqual(img_url.snapshot('a.mp4').metadata.liked, true);
  });

  it('deletes records and removes R2 sources only when asked', async function () {
    const { onRequestPost } = await import('../functions/api/manage/batch.js');
    const img_url = createMockKV({ 'r2-aa.mp4': meta(), 'r2-bb.mp4': meta() });
    const img_r2 = mockR2(['r2-aa.mp4', 'r2-bb.mp4']);

    await onRequestPost(makeContext({ request: post({ action: 'delete', ids: ['r2-aa.mp4'] }), env: { img_url, img_r2 } }));
    assert.strictEqual(img_url.snapshot('r2-aa.mp4'), undefined);
    assert.deepStrictEqual(img_r2.deleted, []);

    const res = await onRequestPost(makeContext({ request: post({ action: 'delete', ids: ['r2-bb.mp4'], deleteSource: true }), env: { img_url, img_r2 } }));
    const data = JSON.parse(await res.text());
    assert.strictEqual(data.results[0].sourceDeleted, true);
    assert.deepStrictEqual(img_r2.deleted, ['r2-bb.mp4']);
  });

  it('rejects unknown actions, empty ids and bad JSON', async function () {
    const { onRequestPost } = await import('../functions/api/manage/batch.js');
    const img_url = createMockKV({});
    for (const body of [{ action: 'nuke', ids: ['a'] }, { action: 'block', ids: [] }, '{bad']) {
      const res = await onRequestPost(makeContext({ request: post(body), env: { img_url } }));
      assert.strictEqual(res.status, 400);
    }
  });

  it('refuses to touch internal bookkeeping keys', async function () {
    const { onRequestPost } = await import('../functions/api/manage/batch.js');
    const img_url = createMockKV({ 'short:abc': { target: 'x.png' } });
    const res = await onRequestPost(makeContext({ request: post({ action: 'delete', ids: ['short:abc'] }), env: { img_url } }));
    const data = JSON.parse(await res.text());
    assert.strictEqual(data.okCount, 0);
    assert.ok(img_url.snapshot('short:abc'));
  });
});

describe('delete API source option', function () {
  it('keeps the R2 object by default and deletes it with ?source=1', async function () {
    const { onRequest } = await import('../functions/api/manage/delete/[id].js');
    const img_url = createMockKV({ 'r2-aa.mp4': meta(), 'r2-bb.mp4': meta() });
    const img_r2 = mockR2(['r2-aa.mp4', 'r2-bb.mp4']);

    const res1 = await onRequest(makeContext({ request: new Request('https://example.com/api/manage/delete/r2-aa.mp4'), env: { img_url, img_r2 }, params: { id: 'r2-aa.mp4' } }));
    assert.strictEqual(JSON.parse(await res1.text()), 'r2-aa.mp4');
    assert.deepStrictEqual(img_r2.deleted, []);

    await onRequest(makeContext({ request: new Request('https://example.com/api/manage/delete/r2-bb.mp4?source=1'), env: { img_url, img_r2 }, params: { id: 'r2-bb.mp4' } }));
    assert.deepStrictEqual(img_r2.deleted, ['r2-bb.mp4']);
  });

  it('never tries to delete Telegram-backed files', async function () {
    const { onRequest } = await import('../functions/api/manage/delete/[id].js');
    const img_url = createMockKV({ 'AgADxyz.mp4': meta() });
    const img_r2 = mockR2([]);
    await onRequest(makeContext({ request: new Request('https://example.com/api/manage/delete/AgADxyz.mp4?source=1'), env: { img_url, img_r2 }, params: { id: 'AgADxyz.mp4' } }));
    assert.deepStrictEqual(img_r2.deleted, []);
  });
});

describe('metadata fileType', function () {
  it('normalizeMetadata keeps fileType so file views do not drop it', async function () {
    const { normalizeMetadata } = await import('../functions/utils/metadata.js');
    const out = normalizeMetadata(meta({ fileType: 'video/mp4' }), 'a.mp4');
    assert.strictEqual(out.fileType, 'video/mp4');
    assert.strictEqual(normalizeMetadata(meta(), 'a.mp4').fileType, undefined);
  });

  it('normalizeMetadata keeps fileHash for duplicate detection', async function () {
    const { normalizeMetadata } = await import('../functions/utils/metadata.js');
    assert.strictEqual(normalizeMetadata(meta({ fileHash: 'abc' }), 'a.png').fileHash, 'abc');
    assert.strictEqual(normalizeMetadata(meta(), 'a.png').fileHash, undefined);
  });
  it('hashFile skips empty input and never throws', async function () {
    const { hashFile } = await import('../functions/upload.js');
    assert.strictEqual(await hashFile(null), null);
    assert.strictEqual(await hashFile(new File([], 'e.txt')), null);
    assert.strictEqual((await hashFile(new File(['x'], 'x.txt'))).length, 32);
  });
});
