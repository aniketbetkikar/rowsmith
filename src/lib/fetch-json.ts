// Client-side fetch helpers: every response is validated with a Zod schema,
// and API errors ({ error: { code, message } }) become ApiClientError.
import { z } from "zod";

const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryAfter: z.number().optional(),
  }),
});

export class ApiClientError extends Error {
  override readonly name = "ApiClientError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export async function fetchJson<T extends z.ZodType>(
  url: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiClientError("Network error. Check your connection and try again.", 0, "network_error");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(body);
    if (parsed.success) {
      const { message, code, retryAfter } = parsed.data.error;
      throw new ApiClientError(message, res.status, code, retryAfter);
    }
    throw new ApiClientError(`Request failed (${res.status}).`, res.status, "http_error");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError("Unexpected response from the server.", res.status, "bad_response");
  }
  return parsed.data;
}

export function postJson<T extends z.ZodType>(url: string, schema: T, body: unknown): Promise<z.infer<T>> {
  return fetchJson(url, schema, { method: "POST", body: JSON.stringify(body) });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
