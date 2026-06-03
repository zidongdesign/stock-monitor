// Cloudflare Worker: OpenRouter API Proxy
// 部署后，HTML里把 https://openrouter.ai/api/v1/chat/completions
// 改成 https://你的worker域名/api/v1/chat/completions

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Forward to OpenRouter
    const url = new URL(request.url);
    const targetUrl = 'https://openrouter.ai' + url.pathname + url.search;

    const newHeaders = new Headers(request.headers);
    newHeaders.delete('host');
    newHeaders.delete('cf-connecting-ip');
    newHeaders.delete('cf-ipcountry');
    newHeaders.delete('x-forwarded-for');
    newHeaders.delete('x-real-ip');

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.method === 'POST' ? request.body : undefined,
    });

    // Copy response with CORS headers
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Headers', '*');

    return newResponse;
  },
};
