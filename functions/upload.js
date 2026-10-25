import { authenticateUploadRequest } from "./utils/auth.js";
import { jsonResponse } from "./utils/http.js";
import { createDefaultMetadata, putMetadata } from "./utils/metadata.js";
import { allocateShortId, isShortUrlsEnabled, putShortLink } from "./utils/shortlink.js";
import { getUploadProvider } from "./storage/index.js";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const authResponse = authenticateUploadRequest(request, env);
        if (authResponse) {
            return authResponse;
        }

        const provider = getUploadProvider(env);
        provider.validateConfig(env);

        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name;
        const fileExtension = fileName.split('.').pop().toLowerCase();

        // 内容哈希（SHA-256 前 32 位十六进制），供后台查找重复文件；失败不影响上传
        const fileHash = await hashFile(uploadFile);

        const longId = await provider.upload(env, uploadFile, { fileName, fileExtension });
        let shortId = null;

        // 将文件信息保存到 KV 存储
        if (env.img_url) {
            if (isShortUrlsEnabled(env)) {
                shortId = await allocateShortId(env);
            }

            await putMetadata(env, longId, createDefaultMetadata(longId, {
                fileName,
                fileSize: uploadFile.size,
                // MIME type lets the dashboard tell videos/images apart without
                // relying on the extension; additive, older records simply lack it.
                ...(uploadFile.type ? { fileType: uploadFile.type } : {}),
                provider: provider.key,
                ...(fileHash ? { fileHash } : {}),
                ...(shortId ? { shortId } : {}),
            }));

            if (shortId) {
                await putShortLink(env, shortId, longId);
            }
        }

        return jsonResponse([{ 'src': `/file/${shortId || longId}` }]);
    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ error: error.message }, { status: 500 });
    }
}

const HASH_MAX_BYTES = 100 * 1024 * 1024;

export async function hashFile(file) {
    try {
        if (!file || typeof file.arrayBuffer !== 'function' || !(file.size > 0) || file.size > HASH_MAX_BYTES) return null;
        if (!globalThis.crypto || !crypto.subtle) return null;
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        return null;
    }
}
