import { jsonResponse } from "../../utils/http.js";
import { LIST_TYPE, getMetadata, updateMetadata } from "../../utils/metadata.js";
import { deleteShortLink } from "../../utils/shortlink.js";
import { deleteSourceFile } from "../../utils/source.js";
import { isInternalKey } from "../../utils/kv-keys.js";

// 新增的批量接口（原有单个接口保持不变）。
// POST /api/manage/batch
//   { "action": "delete" | "block" | "white" | "like" | "unlike" | "rename",
//     "ids": ["xxx.mp4", ...],
//     "deleteSource": false,           // 仅 delete：同时删除 R2 源文件
//     "names": { "id": "新文件名" } }   // 仅 rename
// 返回 { success, action, results: [{ id, ok, error? }], okCount, failCount }
const MAX_IDS = 500;
const ACTIONS = new Set(['delete', 'block', 'white', 'like', 'unlike', 'rename']);

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body && body.action;
    const ids = Array.isArray(body && body.ids) ? body.ids.filter(id => typeof id === 'string' && id) : [];

    if (!ACTIONS.has(action)) {
        return jsonResponse({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
    if (ids.length === 0) {
        return jsonResponse({ success: false, error: 'ids must be a non-empty array' }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
        return jsonResponse({ success: false, error: `At most ${MAX_IDS} ids per request` }, { status: 400 });
    }

    const results = [];
    for (const id of ids) {
        if (isInternalKey(id)) {
            results.push({ id, ok: false, error: 'internal key' });
            continue;
        }
        try {
            results.push(await applyAction(env, action, id, body));
        } catch (error) {
            results.push({ id, ok: false, error: error.message });
        }
    }

    const okCount = results.filter(result => result.ok).length;
    return jsonResponse({
        success: okCount === results.length,
        action,
        results,
        okCount,
        failCount: results.length - okCount,
    });
}

async function applyAction(env, action, id, body) {
    if (action === 'delete') {
        const metadata = await getMetadata(env, id);
        await env.img_url.delete(id);
        if (metadata?.shortId) {
            await deleteShortLink(env, metadata.shortId);
        }
        const sourceDeleted = body.deleteSource ? await deleteSourceFile(env, id) : false;
        return { id, ok: true, sourceDeleted };
    }

    const updated = await updateMetadata(env, id, current => {
        if (action === 'block') current.ListType = LIST_TYPE.BLOCK;
        if (action === 'white') current.ListType = LIST_TYPE.WHITE;
        if (action === 'like') current.liked = true;
        if (action === 'unlike') current.liked = false;
        if (action === 'rename') {
            const name = body.names && body.names[id];
            if (typeof name === 'string' && name.trim()) current.fileName = name.trim();
        }
        return current;
    });

    if (!updated) {
        return { id, ok: false, error: 'metadata not found' };
    }
    return { id, ok: true, metadata: updated };
}
