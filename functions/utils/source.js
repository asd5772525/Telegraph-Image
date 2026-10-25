import { r2Provider } from '../storage/r2.js';

// 删除源文件：只有 R2 存储的文件可以删除；Telegram 上的文件 Bot API 无法删除，返回 false。
export async function deleteSourceFile(env, id) {
    if (!r2Provider.ownsId(id) || !env.img_r2 || typeof env.img_r2.delete !== 'function') {
        return false;
    }
    await env.img_r2.delete(id);
    return true;
}
