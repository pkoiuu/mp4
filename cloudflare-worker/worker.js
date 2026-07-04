/**
 * GitHub Releases 反向代理 - Cloudflare Worker
 * 域名: ghmp4.5201125.xyz
 * 
 * 部署步骤:
 * 1. 登录 Cloudflare Dashboard → Workers & Pages → Create Worker
 * 2. 把本文件内容粘贴到编辑器中,保存部署
 * 3. Settings → Triggers → Custom Domains → 添加 ghmp4.5201125.xyz
 *    (需要先把 5201125.xyz 域名托管到 Cloudflare)
 * 
 * 用法:
 *   原始: https://github.com/pkoiuu/mp4/releases/download/videos-2026-07-04/2025.mp4
 *   加速: https://ghmp4.5201125.xyz/pkoiuu/mp4/releases/download/videos-2026-07-04/2025.mp4
 * 
 * 功能:
 *   - 反代 github.com 的 Releases 下载
 *   - 支持 Range 请求(视频分段加载)
 *   - 自动跟随重定向(release 下载会 302 到 objects.githubusercontent.com)
 *   - 大文件流式传输,不占用 Worker 内存
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 只允许 GET / HEAD 请求
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/favicon.ico') {
      return new Response('GitHub Releases Proxy OK', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // 构建目标 URL:https://github.com + pathname
    const targetUrl = 'https://github.com' + url.pathname + url.search;

    // 转发请求到 GitHub,保留 Range 头(视频分段加载需要)
    const headers = new Headers();
    // 只转发必要的头
    const range = request.headers.get('Range');
    if (range) {
      headers.set('Range', range);
    }
    headers.set('User-Agent', 'cloudflare-worker-proxy');
    headers.set('Accept', '*/*');

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        redirect: 'follow', // 自动跟随 302 重定向到 objects.githubusercontent.com
      });

      // 构建响应头
      const respHeaders = new Headers();
      // 透传必要的头
      const passthroughHeaders = [
        'Content-Type',
        'Content-Length',
        'Content-Range',
        'Accept-Ranges',
        'Cache-Control',
        'ETag',
        'Last-Modified',
      ];
      for (const h of passthroughHeaders) {
        const val = response.headers.get(h);
        if (val) {
          respHeaders.set(h, val);
        }
      }

      // 允许跨域(让 pkoiuu.github.io 能直接播放)
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      respHeaders.set('Access-Control-Allow-Headers', 'Range');
      respHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

      // 缓存策略:Release 文件不变,缓存 7 天
      if (!respHeaders.has('Cache-Control')) {
        respHeaders.set('Cache-Control', 'public, max-age=604800');
      }

      // 流式返回(body 直接透传,不读入内存,支持大文件)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response('Proxy Error: ' + err.message, { status: 502 });
    }
  },

  // 处理 OPTIONS 预检请求(CORS)
  async options() {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Max-Age': '86400',
      },
    });
  },
};
