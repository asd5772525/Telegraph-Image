// 原版在这里接入了原作者的 Sentry（上报请求头、IP 地理位置等），默认开启。
// 本版本已彻底移除第三方遥测：不再加载 Sentry SDK，也不再向任何外部服务上报数据。
// 保留同名导出，确保 _middleware.js 等调用方无需修改、行为保持兼容。

export async function errorHandling(context) {
    return context.next();
}

export function telemetryData(context) {
    return context.next();
}

export async function traceData() {
    // no-op
}
