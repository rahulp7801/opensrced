// Client-side fetch helpers that never show a person a parser or runtime message
// ("Unexpected token '<'", "signal timed out", "Failed to fetch").

/** The JSON body of a successful response; otherwise throws an Error whose
 *  message is fit to show: the server's own `error` text, or a status line. */
export async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new Error("Your session has expired. Sign in again to continue.");
  const body = await response.json().catch(() => undefined) as unknown;
  if (!response.ok) {
    const error = (body as { error?: unknown } | undefined)?.error;
    throw new Error(typeof error === "string" && error.trim() && error.length <= 500
      ? error.trim()
      : `Request failed (${response.status}). Please try again.`);
  }
  if (body === undefined) throw new Error("The server returned an invalid response. Please try again.");
  return body as T;
}

/** A readable message for anything a fetch chain can throw. */
export function requestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "The request timed out. Please try again.";
  if (error instanceof TypeError) return "Network connection lost. Check your connection and try again.";
  if (error instanceof SyntaxError) return "The server returned an invalid response. Please try again.";
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}
