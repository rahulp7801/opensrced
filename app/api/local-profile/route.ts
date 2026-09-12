export function GET() {
  if (process.env.AUTH_DISABLED !== "1" || process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ sub: "local-dev", name: "Local workspace" });
}
