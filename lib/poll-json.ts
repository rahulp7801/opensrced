/** Serial polling with a deadline and cleanup for each mounted consumer. */
async function responseError(response: Response): Promise<string> {
  if (response.status === 401) return "Your session has expired. Sign in again to continue.";
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

export type PollResult<T> = { data: T; error: null; status: number } | { data: null; error: string; status: number | null };

/** Poll `url` every `intervalMs` (once when 0). `receive` returning `false`
 *  stops polling, e.g. once a run has finished. Polling also stops on 401 and
 *  404: retrying cannot fix either. */
export function pollJson<T>(
  url: string | (() => string),
  receive: (result: PollResult<T>) => void | boolean,
  intervalMs = 0,
  timeoutMs = 30_000,
): () => void {
  let stopped = false;
  let controller: AbortController;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    let keepGoing = true;
    let status: number | null = null;
    try {
      const response = await fetch(typeof url === "function" ? url() : url, { cache: "no-store", signal: controller.signal });
      status = response.status;
      if (!response.ok) throw new Error(await responseError(response));
      // A 200 with a body that is not JSON is a server fault, not a parser message for the user.
      const data = await response.json().catch(() => { throw new Error("The server returned an invalid response. Please try again."); }) as T;
      if (!stopped) keepGoing = receive({ data, error: null, status }) !== false;
    } catch (error) {
      if (!stopped) {
        const message = controller.signal.aborted ? "Request timed out. Please try again."
          : status === null && error instanceof TypeError ? "Network connection lost. Check your connection."
          : error instanceof Error ? error.message : String(error);
        keepGoing = receive({ data: null, error: message, status }) !== false && status !== 401 && status !== 404;
      }
    } finally {
      clearTimeout(deadline);
      if (!stopped && keepGoing && intervalMs > 0) timer = setTimeout(tick, intervalMs);
    }
  }
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
