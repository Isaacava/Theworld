import "server-only";

type OverpassPayload<T> = { elements: T[] };

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

/**
 * Query a public OpenStreetMap Overpass instance with a bounded timeout and
 * a secondary endpoint. Callers should cache results and handle total failure.
 */
export async function fetchOverpassJson<T>(query: string): Promise<OverpassPayload<T>> {
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2600);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "Accept": "application/json",
          "User-Agent": "THE-WORLD-prototype/0.1 (https://github.com/Isaacava/Theworld)",
        },
        body: new URLSearchParams({ data: query }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as { elements?: unknown };
      if (!payload || !Array.isArray(payload.elements)) continue;
      return { elements: payload.elements as T[] };
    } catch {
      // Try the next public endpoint; the callers provide cache/DB fallbacks.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("OpenStreetMap nearby data is temporarily unavailable.");
}
