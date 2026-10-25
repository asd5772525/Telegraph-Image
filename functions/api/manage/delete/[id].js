import { jsonResponse } from "../../../utils/http.js";
import { getMetadata } from "../../../utils/metadata.js";
import { deleteShortLink } from "../../../utils/shortlink.js";
import { deleteSourceFile } from "../../../utils/source.js";

// GET/POST /api/manage/delete/:id            -> 只删除 KV 记录（与原版一致）
// GET/POST /api/manage/delete/:id?source=1   -> 同时删除 R2 中的源文件（Telegram 文件无法删除）
// 返回值保持原样：被删除的 id 字符串。
export async function onRequest(context) {
    const { env, params, request } = context;
    const url = new URL(request.url);

    const metadata = await getMetadata(env, params.id);
    await env.img_url.delete(params.id);

    if (metadata?.shortId) {
        await deleteShortLink(env, metadata.shortId);
    }

    if (isTruthy(url.searchParams.get('source'))) {
        await deleteSourceFile(env, params.id);
    }

    return jsonResponse(params.id);
}

function isTruthy(value) {
    return value === '1' || value === 'true';
}
