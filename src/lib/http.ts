import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

export type ApiError = {
  error: { code: string; message: string; retryAfter?: number };
};

type Parsed<T> = { data: T; response?: never } | { data?: never; response: NextResponse<ApiError> };

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

export function fail(
  code: string,
  message: string,
  status: number,
  extra?: { retryAfter?: number; headers?: HeadersInit },
): NextResponse<ApiError> {
  const body: ApiError = { error: { code, message } };
  if (extra?.retryAfter !== undefined) body.error.retryAfter = extra.retryAfter;
  return NextResponse.json(body, { status, headers: extra?.headers });
}

/** Zod issues → one readable line: "config.fields.0.name: Use snake_case…; …". */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/** Validates any value (params, query) with a schema; 400 on failure. */
export function parseInput<T extends z.ZodType>(value: unknown, schema: T): Parsed<z.infer<T>> {
  const result = schema.safeParse(value);
  return result.success
    ? { data: result.data }
    : { response: fail("invalid_request", describeIssues(result.error), 400) };
}

/** Reads a JSON body and validates it; 400 on bad JSON or schema failure. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<Parsed<z.infer<T>>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { response: fail("invalid_json", "Request body must be valid JSON.", 400) };
  }
  return parseInput(json, schema);
}

/** Runs a handler and turns unexpected errors into a uniform 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    console.error("[api] unhandled error", err);
    return fail("internal_error", "Something went wrong. Please try again.", 500);
  }
}
