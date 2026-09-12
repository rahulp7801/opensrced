/** Serial polling with a deadline and cleanup for each mounted consumer. */
async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string") {
      const message = body.error.trim();
      if (message && message.length <= 500) return message;
    }
  } catch {
    // Non-JSON failures use the stable status fallback below.
  }
  return `Request failed (${response.status}). Please try again.`;
}

export function pollJson<T>(
  url: string | (() => string),
  receive: (result: { data: T; error: null } | { data: null; error: string }) => void,
  intervalMs = 0,
  timeoutMs = 30_000,
): () => void {
  let stopped = false;
  let controller: AbortController;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(typeof url === "function" ? url() : url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as T;
      if (!stopped) receive({ data, error: null });
    } catch (error) {
      if (!stopped) receive({ data: null, error: controller.signal.aborted
        ? "Request timed out. Please try again."
        : error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(deadline);
      if (!stopped && intervalMs > 0) timer = setTimeout(tick, intervalMs);
    }
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
