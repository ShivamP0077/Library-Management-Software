/** Parse an API reply; a non-JSON (HTML) reply becomes a plain-language error instead of raw text. */
export function parseJsonSafe(text, status) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {
    const busy = status === 429 || status >= 500;
    return { error: busy ? 'The server is busy or starting up. Please try again in a minute.' : `Unexpected reply from the server (${status}).` };
  }
}

