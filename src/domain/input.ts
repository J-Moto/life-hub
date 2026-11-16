/** Input checks for the routes that change data. Reject anything odd rather than trying to fix it. */

export const MAX_TITLE = 300;
export const MAX_BODY_BYTES = 4096;

export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Drop control characters, collapse whitespace.
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length === 0 || t.length > MAX_TITLE) return null;
  return t;
}

export function withJobPrefix(title: string, job: unknown): string {
  if (job !== true) return title;
  return /^JOB:/i.test(title) ? title : `JOB: ${title}`;
}

export function validTaskId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Reads the body, giving up as soon as it is over `max` bytes. Nothing past the limit is read. */
async function readBytes(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(max);
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes.subarray(0, length);
    const chunk = value as Uint8Array;
    if (length + chunk.byteLength > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    bytes.set(chunk, length);
    length += chunk.byteLength;
  }
}

/**
 * Reads a small JSON body or returns null. The content type must be exactly
 * `application/json` (parameters such as a charset are allowed), the body at most
 * MAX_BODY_BYTES bytes, valid UTF-8, and a JSON object.
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const mediaType = (request.headers.get("Content-Type") ?? "").split(";")[0] ?? "";
  if (mediaType.trim().toLowerCase() !== "application/json") return null;
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  // The declared length can be missing or wrong, so the body itself is measured too.
  const bytes = await readBytes(request, MAX_BODY_BYTES);
  if (!bytes) return null;
  try {
    // `fatal`: bytes that aren't UTF-8 are refused, not replaced.
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
