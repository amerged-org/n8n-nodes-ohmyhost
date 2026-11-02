import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
} from "n8n-workflow";

export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions;
export type JsonObject = Record<string, unknown>;
export const apiOrigin = "https://app.ohmyho.st";
export class SafeError extends Error {
  constructor(
    message: string,
    public readonly receipt?: IDataObject,
  ) {
    super(message);
  }
}
export function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function text(value: unknown, label: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new SafeError(`Invalid ${label}`);
  return value;
}
export function ulid(value: unknown, label = "ID"): string {
  const result = text(value, label);
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(result))
    throw new SafeError(`Invalid ${label}`);
  return result;
}
export function segment(value: unknown, label = "ID"): string {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(result) || result === "." || result === "..")
    throw new SafeError(`Invalid ${label}`);
  return encodeURIComponent(result);
}
export function environment(value: unknown): string {
  if (value !== "dev" && value !== "prod")
    throw new SafeError("Choose an explicit Dev or Prod environment");
  return value;
}
export function idempotency(value: unknown): string {
  const result = text(value, "idempotency key", 128);
  if (/[\r\n]/.test(result)) throw new SafeError("Invalid idempotency key");
  return result;
}
export function jsonArray(
  value: unknown,
  label: string,
  max: number,
  scalar = false,
): unknown[] {
  let result: unknown;
  try {
    result = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    result = undefined;
  }
  if (!Array.isArray(result) || result.length > max)
    throw new SafeError(`Invalid ${label} array`);
  let nodes = 0;
  function check(node: unknown, depth: number): void {
    if (++nodes > 10000 || depth > 8)
      throw new SafeError("JSON parameters exceed nesting or size limits");
    if (node === null || typeof node === "string" || typeof node === "boolean")
      return;
    if (typeof node === "number" && Number.isFinite(node)) return;
    if (scalar) throw new SafeError(`${label} must contain scalar JSON values`);
    if (Array.isArray(node)) {
      for (const child of node) check(child, depth + 1);
      return;
    }
    if (record(node)) {
      for (const child of Object.values(node)) check(child, depth + 1);
      return;
    }
    throw new SafeError(`Invalid ${label} JSON value`);
  }
  for (const node of result) check(node, 0);
  return result;
}
export function names(value: unknown, label: string, max = 32): string[] {
  const items = jsonArray(value, label, max);
  if (
    !items.length ||
    items.some(
      (v) => typeof v !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(v),
    ) ||
    new Set(items).size !== items.length
  )
    throw new SafeError(`Invalid ${label}`);
  return items as string[];
}
export function tableColumns(value: unknown): JsonObject[] {
  const columns = jsonArray(value, "columns", 64);
  if (!columns.length) throw new SafeError("At least one column is required");
  const seen = new Set<string>();
  let identities = 0;
  for (const column of columns) {
    if (
      !record(column) ||
      Object.keys(column).some(
        (k) => !["name", "type", "nullable", "identity", "default"].includes(k),
      ) ||
      typeof column.name !== "string" ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(column.name) ||
      seen.has(column.name) ||
      ![
        "text",
        "boolean",
        "integer",
        "bigint",
        "numeric",
        "double precision",
        "uuid",
        "timestamptz",
        "date",
        "jsonb",
      ].includes(String(column.type))
    )
      throw new SafeError("Invalid table column definition");
    seen.add(column.name);
    if (column.nullable !== undefined && typeof column.nullable !== "boolean")
      throw new SafeError("Invalid column nullable flag");
    if (column.identity !== undefined && typeof column.identity !== "boolean")
      throw new SafeError("Invalid column identity flag");
    if (column.identity) {
      identities++;
      if (
        !["integer", "bigint"].includes(String(column.type)) ||
        column.default !== undefined ||
        column.nullable === true
      )
        throw new SafeError(
          "Identity columns require integer or bigint, no default, and NOT NULL",
        );
    }
    if (
      column.default !== undefined &&
      !(
        (column.default === "now" && column.type === "timestamptz") ||
        (column.default === "uuid" && column.type === "uuid")
      )
    )
      throw new SafeError("Invalid column default");
  }
  if (identities > 1)
    throw new SafeError("Only one identity column is supported");
  return columns as JsonObject[];
}
function errorStatus(error: unknown): number | undefined {
  if (!record(error)) return undefined;
  for (const value of [
    error.statusCode,
    error.httpCode,
    record(error.response) ? error.response.status : undefined,
  ]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 300 && status <= 599)
      return status;
  }
  return undefined;
}
export async function request(
  context: ApiContext,
  method: IHttpRequestOptions["method"],
  path: string,
  body?: JsonObject,
  qs?: IDataObject,
  key?: string,
): Promise<JsonObject> {
  if (!path.startsWith("/v1/") || path.includes("..") || /[?#]/.test(path))
    throw new SafeError("Invalid API route");
  const url = new URL(path, apiOrigin);
  if (url.origin !== apiOrigin) throw new SafeError("Invalid API origin");
  const headers: IDataObject = { Accept: "application/json" };
  if (key !== undefined) headers["Idempotency-Key"] = idempotency(key);
  if (body !== undefined) {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(body);
    } catch {
      encoded = undefined;
    }
    if (encoded === undefined) throw new SafeError("Request body must be JSON");
    if (new TextEncoder().encode(encoded).length > 65600)
      throw new SafeError("Request body exceeds the API 65,600-byte limit");
  }
  const options: IHttpRequestOptions = {
    method,
    url: url.href,
    headers,
    json: true,
    disableFollowRedirect: true,
    returnFullResponse: true,
    timeout: 60000,
    ...(body === undefined ? {} : { body: body as IDataObject }),
    ...(qs === undefined ? {} : { qs }),
  };
  let response: unknown;
  let failed = false;
  let statusCode: number | undefined;
  try {
    response = await context.helpers.httpRequestWithAuthentication.call(
      context,
      "ohmyhostApi",
      options,
    );
  } catch (error) {
    failed = true;
    statusCode = errorStatus(error);
  }
  if (failed)
    throw new SafeError(
      statusCode
        ? `ohmyho.st returned HTTP ${statusCode}. Check the connection and inputs; retain the same idempotency key after uncertainty.`
        : "The ohmyho.st request did not complete. Retain the same idempotency key for an uncertain mutation.",
    );
  if (!record(response) || !Number.isInteger(response.statusCode))
    throw new SafeError("Unexpected HTTP response from ohmyho.st");
  const status = response.statusCode as number;
  if (status < 200 || status >= 300)
    throw new SafeError(
      `ohmyho.st returned HTTP ${status}. Check the connection and inputs; retain the same idempotency key after uncertainty.`,
    );
  if (
    (status === 204 || status === 205) &&
    (response.body === "" || response.body === undefined)
  )
    return {};
  if (!record(response.body))
    throw new SafeError("Unexpected JSON response from ohmyho.st");
  return response.body;
}
export function rows(body: JsonObject): JsonObject[] {
  if (!Array.isArray(body.items) || body.items.some((item) => !record(item)))
    throw new SafeError("Unexpected list response from ohmyho.st");
  return body.items as JsonObject[];
}
export async function allProjects(context: ApiContext): Promise<JsonObject[]> {
  const found: JsonObject[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const data = await request(context, "GET", "/v1/projects", undefined, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    found.push(...rows(data));
    if (!data.next_cursor) return found;
    cursor = ulid(data.next_cursor, "project pagination cursor");
    if (seen.has(cursor))
      throw new SafeError("Unexpected repeating project pagination cursor");
    seen.add(cursor);
  }
  throw new SafeError(
    "Project choices exceed 5,000 entries. Use an expression with a project ID.",
  );
}
export function safeWebhook(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeWebhook);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !["url", "headers", "secret", "signing_secret"].includes(key),
      )
      .map(([key, child]) => [key, safeWebhook(child)]),
  );
}
export function safeExport(data: JsonObject, includeUrl: boolean): JsonObject {
  const out = Object.fromEntries(
    [
      "id",
      "project_id",
      "state",
      "created_at",
      "updated_at",
      "requested_at",
      "next_request_at",
      "next_poll_after_seconds",
    ]
      .filter((k) => k in data)
      .map((k) => [k, data[k]]),
  );
  if (record(data.error))
    out.error = {
      code:
        typeof data.error.code === "string" &&
        /^[a-z0-9_]{1,128}$/.test(data.error.code)
          ? data.error.code
          : "export_failed",
    };
  else if ("error" in data) out.error = null;
  if (record(data.archive))
    out.archive = Object.fromEntries(
      [
        "bytes",
        "sha256",
        "sql_files",
        "captured_at",
        "expires_at",
        "download_expires_at",
        ...(includeUrl ? ["download_url"] : []),
      ]
        .filter((k) => k in (data.archive as JsonObject))
        .map((k) => [k, (data.archive as JsonObject)[k]]),
    );
  else if ("archive" in data) out.archive = null;
  return out;
}
