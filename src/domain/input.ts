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

/** Reads a small JSON body or returns null. The size limit counts bytes, not characters. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return null;
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  // The declared length can be missing or wrong, so the body itself is measured too.
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
