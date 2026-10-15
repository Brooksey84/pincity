// Adapts the Express app to Netlify Functions (the current kind: a Web Request in, a Response out).
// serverless-http speaks the older Lambda event shape, so we translate both ways here.
const serverless = require('serverless-http');

function toWebHandler(app) {
  const handle = serverless(app);
  return async (request) => {
    const url = new URL(request.url);
    const body = ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
    const headers = Object.fromEntries(request.headers);
    const query = Object.fromEntries(url.searchParams);
    const result = await handle({
      path: url.pathname,
      httpMethod: request.method,
      headers,
      queryStringParameters: Object.keys(query).length ? query : null,
      body: body && body.length ? body.toString('base64') : null,
      isBase64Encoded: true,
    }, {});

    const out = new Headers();
    for (const [k, v] of Object.entries(result.headers || {})) out.set(k, String(v));
    for (const [k, values] of Object.entries(result.multiValueHeaders || {})) {
      out.delete(k);
      for (const v of values) out.append(k, String(v));
    }
    const payload = result.body ? Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8') : null;
    return new Response(payload, { status: result.statusCode, headers: out });
  };
}

module.exports = { toWebHandler };
