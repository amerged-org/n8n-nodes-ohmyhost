import type { IExecuteFunctions } from "n8n-workflow";
import {
  allProjects,
  environment,
  idempotency,
  jsonArray,
  names,
  request,
  rows,
  safeExport,
  SafeError,
  safeWebhook,
  segment,
  tableColumns,
  text,
  ulid,
  type JsonObject,
} from "./GenericFunctions";

export async function executeOperation(
  context: IExecuteFunctions,
  index: number,
): Promise<JsonObject | JsonObject[]> {
  const p = (name: string, fallback?: string | number | boolean): unknown =>
    context.getNodeParameter(name, index, fallback);
  const resource = p("resource");
  const operation = p("operation");
  const project = () => `/v1/projects/${ulid(p("projectId"), "project ID")}`;
  const env = () => environment(p("environment"));
  const key = () => idempotency(p("idempotencyKey"));
  const confirm = () => {
    if (p("confirmRemoval") !== true)
      throw new SafeError(
        "Confirm removal after reviewing its effect on subscribers",
      );
  };
  if (resource === "project") {
    if (operation === "getMany") {
      if (p("returnAll", false) === true) return allProjects(context);
      const limit = p("limit", 50);
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
        throw new SafeError("Limit must be an integer from 1 to 100");
      return rows(
        await request(context, "GET", "/v1/projects", undefined, {
          limit: Number(limit),
        }),
      );
    }
    if (operation === "get") return request(context, "GET", project());
    if (operation === "status")
      return request(context, "GET", `${project()}/status`);
    if (operation === "create") {
      const name = text(p("projectName"), "project name", 128);
      if (
        name !== name.trim() ||
        [...name].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new SafeError(
          "Project name must not contain control characters or surrounding whitespace",
        );
      const region = p("region");
      const dataMode = p("dataMode");
      const access = p("devAccessMode");
      if (
        !["us", "eu"].includes(String(region)) ||
        !["shared", "isolated"].includes(String(dataMode)) ||
        !["protected", "public"].includes(String(access))
      )
        throw new SafeError("Choose a region, data mode and Dev access mode");
      return request(
        context,
        "POST",
        "/v1/projects",
        {
          organization_id: ulid(p("organizationId"), "workspace ID"),
          name,
          region,
          data_mode: dataMode,
          dev_access_mode: access,
        },
        undefined,
        key(),
      );
    }
  }
  if (resource === "operation" && operation === "get")
    return request(
      context,
      "GET",
      `/v1/operations/${ulid(p("operationId"), "operation ID")}`,
    );
  if (resource === "database") {
    if (operation === "query" || operation === "write") {
      const statement = text(
        p("statement"),
        "SQL statement",
        operation === "query" ? 4096 : 65536,
      );
      if (
        !(
          operation === "query"
            ? /^\s*(SELECT|WITH)\b/i
            : /^\s*(INSERT|UPDATE|DELETE)\b/i
        ).test(statement)
      )
        throw new SafeError(
          operation === "query"
            ? "Read queries must start with SELECT or WITH"
            : "Write statements must start with INSERT, UPDATE or DELETE",
        );
      if (
        operation === "write" &&
        new TextEncoder().encode(statement).length > 65536
      )
        throw new SafeError("SQL statement exceeds 64 KiB");
      const parameters = jsonArray(
        p("parameters", "[]"),
        "parameters",
        operation === "query" ? 50 : 100,
        operation === "query",
      );
      const result = await request(
        context,
        "POST",
        `${project()}/database/${operation}`,
        { environment: env(), statement, parameters },
        undefined,
        operation === "write" ? key() : undefined,
      );
      if (operation === "write" && result.state !== "succeeded") {
        const operationId =
          typeof result.operation_id === "string" &&
          /^[0-9A-HJKMNP-TV-Z]{26}$/.test(result.operation_id)
            ? result.operation_id
            : undefined;
        const state = ["running", "failed"].includes(String(result.state))
          ? String(result.state)
          : "incomplete";
        throw new SafeError(
          `SQL write is ${state}.${operationId ? ` Operation ID: ${operationId}.` : ""} Inspect the operation before retrying with the same idempotency key.`,
          { state, ...(operationId ? { operation_id: operationId } : {}) },
        );
      }
      return result;
    }
    if (operation === "createTable") {
      const table = text(p("table"), "table name");
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table) || table.startsWith("pg_"))
        throw new SafeError(
          "Use a lowercase application table name without the pg_ prefix",
        );
      const columns = tableColumns(p("columns"));
      const body: JsonObject = { environment: env(), table, columns };
      const primaryKey = p("primaryKey", "[]");
      if (
        primaryKey !== "" &&
        primaryKey !== undefined &&
        jsonArray(primaryKey, "primary key", 8).length > 0
      ) {
        const keys = names(primaryKey, "primary key", 8);
        if (
          keys.some(
            (k) => !columns.some((c) => c.name === k && c.nullable !== true),
          )
        )
          throw new SafeError(
            "Primary key columns must exist and must not be nullable",
          );
        body.primary_key = keys;
      }
      return request(
        context,
        "POST",
        `${project()}/database/tables`,
        body,
        undefined,
        key(),
      );
    }
  }
  if (resource === "watch") {
    if (operation === "getMany")
      return rows(
        await request(
          context,
          "GET",
          `${project()}/database/watches`,
          undefined,
          { environment: env() },
        ),
      );
    if (operation === "create") {
      const schema = names([p("schema", "public")], "schema", 1)[0];
      const table = names([p("table")], "table", 1)[0];
      if (
        ["pgcf", "ohmyhost", "information_schema"].includes(schema) ||
        schema.startsWith("pg_")
      )
        throw new SafeError("System schemas cannot be watched");
      const columns = names(p("watchColumns"), "published columns");
      const operations = jsonArray(p("watchOperations"), "watch operations", 3);
      if (
        !operations.length ||
        operations.some(
          (o) => !["insert", "update", "delete"].includes(String(o)),
        ) ||
        new Set(operations).size !== operations.length
      )
        throw new SafeError(
          "Choose unique insert, update and/or delete operations",
        );
      const idem = key();
      const environmentName = env();
      const existing = rows(
        await request(
          context,
          "GET",
          `${project()}/database/watches`,
          undefined,
          { environment: environmentName },
        ),
      );
      const watch = existing.find(
        (w) => w.schema === schema && w.table === table,
      );
      if (watch && p("replaceExisting", false) !== true) {
        const sameSet = (left: unknown, right: unknown[]) =>
          Array.isArray(left) &&
          left.length === right.length &&
          new Set(left).size === right.length &&
          right.every((item) => left.includes(item));
        if (
          sameSet(watch.columns, columns) &&
          sameSet(watch.operations, operations)
        )
          return watch;
        throw new SafeError(
          "A different watch already exists. Review all subscribers before explicitly allowing replacement",
        );
      }
      return request(
        context,
        "POST",
        `${project()}/database/watches`,
        { environment: environmentName, schema, table, columns, operations },
        undefined,
        idem,
      );
    }
    if (operation === "delete") {
      confirm();
      return request(
        context,
        "DELETE",
        `${project()}/database/watches/${segment(p("watchId"), "watch ID")}`,
        undefined,
        { environment: env() },
        key(),
      );
    }
  }
  if (resource === "webhook") {
    if (operation === "getMany")
      return safeWebhook(
        rows(
          await request(
            context,
            "GET",
            `${project()}/database/webhooks`,
            undefined,
            { environment: env() },
          ),
        ),
      ) as JsonObject[];
    if (operation === "create") {
      const url = text(p("url"), "HTTPS receiver URL", 2048);
      let target: URL | undefined;
      try {
        target = new URL(url);
      } catch {
        target = undefined;
      }
      if (!target) throw new SafeError("Enter a valid HTTPS receiver URL");
      if (target.protocol !== "https:" || target.username || target.password)
        throw new SafeError(
          "Enter a valid HTTPS receiver URL without embedded credentials",
        );
      const eventTypes = jsonArray(p("eventTypes"), "event types", 16);
      if (
        !eventTypes.length ||
        eventTypes.some(
          (e) =>
            typeof e !== "string" ||
            !/^(?:data\.(?:\*|[a-z][a-z0-9_]{0,47})|database\.(?:created|ready|woke|slept|suspended|resized|deleted))$/.test(
              e,
            ),
        ) ||
        new Set(eventTypes).size !== eventTypes.length
      )
        throw new SafeError("Choose valid unique database event types");
      return safeWebhook(
        await request(
          context,
          "POST",
          `${project()}/database/webhooks`,
          { url, event_types: eventTypes },
          { environment: env() },
          key(),
        ),
      ) as JsonObject;
    }
    if (operation === "test")
      return safeWebhook(
        await request(
          context,
          "POST",
          `${project()}/database/webhooks/${segment(p("webhookId"), "webhook ID")}/test`,
          undefined,
          { environment: env() },
        ),
      ) as JsonObject;
    if (operation === "delete") {
      confirm();
      return safeWebhook(
        await request(
          context,
          "DELETE",
          `${project()}/database/webhooks/${segment(p("webhookId"), "webhook ID")}`,
          undefined,
          { environment: env() },
        ),
      ) as JsonObject;
    }
  }
  if (resource === "export") {
    if (operation === "request") {
      const credentials = await context.getCredentials("ohmyhostApi");
      const password = credentials.zipPassword;
      if (
        typeof password !== "string" ||
        !password.trim() ||
        new TextEncoder().encode(password).length > 1024
      )
        throw new SafeError(
          "Set and securely retain a ZIP password in the ohmyho.st credential before requesting an export",
        );
      return safeExport(
        await request(
          context,
          "POST",
          `${project()}/exports`,
          { password },
          undefined,
          key(),
        ),
        false,
      );
    }
    if (operation === "get")
      return safeExport(
        await request(
          context,
          "GET",
          `${project()}/exports/${ulid(p("exportId"), "export ID")}`,
        ),
        p("includeDownloadUrl", false) === true,
      );
  }
  throw new SafeError("Choose a supported resource and operation");
}
