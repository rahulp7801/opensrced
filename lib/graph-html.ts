/** Graph labels originate in repository content; isolate HTML even when opened directly. */
export function graphHtmlResponse(html: string): Response {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  } });
}
