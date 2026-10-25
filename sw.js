// 最小化 Service Worker：仅为支持“添加到主屏幕”。
// 不缓存任何内容（避免后台数据或页面版本过期），所有请求直接走网络。
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* 直接走网络 */ });
