const { test } = require("node:test");
const assert = require("node:assert/strict");
const { executeOperation } = require("../dist/nodes/Ohmyhost/Operations.js");
const {
  request,
  allProjects,
} = require("../dist/nodes/Ohmyhost/GenericFunctions.js");

const PROJECT = "01M00000000000000000000001";
const ORGANIZATION = "01M00000000000000000000002";
const WEBHOOK = "whk_0123456789abcdefghij";
const EXPORT = "01M00000000000000000000004";
const OPERATION = "01M00000000000000000000005";
const CURSOR = "01M00000000000000000000006";
const WATCH = "pgcf_watch_01234567";
const at = "2026-01-01T00:00:00Z";
const watch = {
  id: WATCH,
  environment: "dev",
  schema: "public",
  table: "orders",
  columns: ["id", "title"],
  operations: ["insert", "update"],
  topic: "orders",
  event_type: "data.orders",
};
const webhook = {
  id: WEBHOOK,
  project_id: PROJECT,
  environment: "dev",
  url: "https://receiver.example.invalid/private-destination",
  headers: { Authorization: "private-receiver-header" },
  event_types: ["data.orders"],
  header_names: ["Authorization"],
  created_at: at,
  secret: "private-signing-secret",
};
const readyExport = {
  id: EXPORT,
  project_id: PROJECT,
  state: "succeeded",
  requested_at: at,
  next_request_at: "2026-01-02T00:00:00Z",
  error: null,
  archive: {
    bytes: 256,
    sha256: `sha256:${"0".repeat(64)}`,
    sql_files: ["dev.sql", "prod.sql"],
    captured_at: at,
    expires_at: "2026-01-08T00:00:00Z",
    download_expires_at: "2026-01-02T00:00:00Z",
    download_url: "https://download.example.invalid/private-signed-link",
  },
};

function context(
  parameters,
  responder,
  credentials = {
    apiKey: "private-api-key",
    zipPassword: "  retain these exact password bytes  ",
  },
) {
  const calls = [];
  const credentialReads = [];
  return {
    calls,
    credentialReads,
    getNodeParameter(name, _index, fallback) {
      return Object.hasOwn(parameters, name) ? parameters[name] : fallback;
    },
    async getCredentials(name) {
      credentialReads.push(name);
      return credentials;
    },
    helpers: {
      async httpRequestWithAuthentication(name, options) {
        assert.equal(name, "ohmyhostApi");
        assert.equal(new URL(options.url).origin, "https://app.ohmyho.st");
        assert.equal(options.disableFollowRedirect, true);
        assert.equal(options.returnFullResponse, true);
        assert.equal(options.json, true);
        assert.doesNotMatch(
          JSON.stringify(options.qs ?? {}),
          /private-api-key|password|api_key/i,
        );
        calls.push(options);
        return typeof responder === "function"
          ? responder(options, calls.length)
          : { body: responder, statusCode: 200 };
      },
    },
  };
}

const base = {
  projectId: PROJECT,
  environment: "dev",
  idempotencyKey: "stable-test-key",
  returnAll: false,
  limit: 10,
};
const projectPath = `/v1/projects/${PROJECT}`;
const pathOf = (call) => new URL(call.url).pathname;
const mutation = (ctx, method) => ctx.calls.filter((c) => c.method === method);

test("project getMany returns real list records and respects the requested limit", async () => {
  const ctx = context(
    { ...base, resource: "project", operation: "getMany" },
    { items: [{ id: PROJECT, name: "Example Project" }], next_cursor: null },
  );
  const result = await executeOperation(ctx, 0);
  assert.deepEqual(result, [{ id: PROJECT, name: "Example Project" }]);
  assert.equal(pathOf(ctx.calls[0]), "/v1/projects");
  assert.equal(ctx.calls[0].qs.limit, 10);
});

test("project get targets the explicitly selected project", async () => {
  const ctx = context(
    { ...base, resource: "project", operation: "get" },
    { id: PROJECT },
  );
  assert.deepEqual(await executeOperation(ctx, 0), { id: PROJECT });
  assert.equal(pathOf(ctx.calls[0]), projectPath);
});

test("project status retrieves deployment state without starting a deployment", async () => {
  const ctx = context(
    { ...base, resource: "project", operation: "status" },
    { project_id: PROJECT, lifecycle: "active" },
  );
  const result = await executeOperation(ctx, 0);
  assert.equal(result.lifecycle, "active");
  assert.equal(pathOf(ctx.calls[0]), `${projectPath}/status`);
  assert.ok(ctx.calls.every((c) => c.method === "GET"));
});

test("project create starts an asynchronous operation with explicit workspace/region/data settings", async () => {
  const ctx = context(
    {
      ...base,
      resource: "project",
      operation: "create",
      organizationId: ORGANIZATION,
      projectName: "Connector test",
      region: "us",
      dataMode: "isolated",
      devAccessMode: "protected",
    },
    () => ({ statusCode: 202, body: { id: OPERATION, state: "queued" } }),
  );
  const result = await executeOperation(ctx, 0);
  assert.equal(result.state, "queued");
  const call = mutation(ctx, "POST")[0];
  assert.equal(pathOf(call), "/v1/projects");
  assert.deepEqual(call.body, {
    organization_id: ORGANIZATION,
    name: "Connector test",
    region: "us",
    data_mode: "isolated",
    dev_access_mode: "protected",
  });
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
  assert.notEqual(result.created, true);
});

test("operation get uses the receipt ID supplied by an earlier action", async () => {
  const ctx = context(
    {
      ...base,
      resource: "operation",
      operation: "get",
      operationId: OPERATION,
    },
    { id: OPERATION, state: "running" },
  );
  assert.equal((await executeOperation(ctx, 0)).state, "running");
  assert.equal(pathOf(ctx.calls[0]), `/v1/operations/${OPERATION}`);
});

test("database query sends one parameterized read with explicit environment and retains result metadata", async () => {
  const parameters = ["marker", 5, true, null];
  const ctx = context(
    {
      ...base,
      resource: "database",
      operation: "query",
      statement: "SELECT $1 AS marker",
      parameters: JSON.stringify(parameters),
    },
    { rows: [{ marker: "marker" }], row_count: 1, truncated: false },
  );
  const result = await executeOperation(ctx, 0);
  assert.equal(result.row_count, 1);
  assert.equal(pathOf(ctx.calls[0]), `${projectPath}/database/query`);
  assert.deepEqual(ctx.calls[0].body, {
    environment: "dev",
    statement: "SELECT $1 AS marker",
    parameters,
  });
});

test("database write forwards JSON values and stable idempotency without returning SQL values", async () => {
  const parameters = [{ example: ["nested", 7] }];
  const ctx = context(
    {
      ...base,
      resource: "database",
      operation: "write",
      statement: "INSERT INTO orders (details) VALUES ($1)",
      parameters,
    },
    { operation_id: OPERATION, state: "succeeded", affected_rows: 1 },
  );
  assert.equal((await executeOperation(ctx, 0)).affected_rows, 1);
  const call = ctx.calls[0];
  assert.equal(pathOf(call), `${projectPath}/database/write`);
  assert.deepEqual(call.body.parameters, parameters);
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
});

test("database createTable calls the direct table API with a supported definition", async () => {
  const columns = [
    { name: "id", type: "bigint", identity: true, nullable: false },
    { name: "title", type: "text", nullable: true },
  ];
  const ctx = context(
    {
      ...base,
      resource: "database",
      operation: "createTable",
      table: "orders",
      columns: JSON.stringify(columns),
      primaryKey: '["id"]',
    },
    { created: true, table: "orders", schema: "public" },
  );
  assert.equal((await executeOperation(ctx, 0)).created, true);
  assert.equal(pathOf(ctx.calls[0]), `${projectPath}/database/tables`);
  assert.deepEqual(ctx.calls[0].body, {
    environment: "dev",
    table: "orders",
    columns,
    primary_key: ["id"],
  });
  assert.equal(ctx.calls[0].headers["Idempotency-Key"], base.idempotencyKey);
});

test("watch getMany queries the selected environment and returns watch records", async () => {
  const ctx = context(
    { ...base, resource: "watch", operation: "getMany" },
    { items: [watch] },
  );
  assert.deepEqual(await executeOperation(ctx, 0), [watch]);
  assert.equal(pathOf(ctx.calls[0]), `${projectPath}/database/watches`);
  assert.deepEqual(ctx.calls[0].qs, { environment: "dev" });
});

test("watch create preflights existing watches then sends only selected columns and operations", async () => {
  const ctx = context(
    {
      ...base,
      resource: "watch",
      operation: "create",
      schema: "public",
      table: "orders",
      watchColumns: '["id","title"]',
      watchOperations: ["insert", "update"],
      replaceExisting: false,
    },
    (options) => ({
      statusCode: 200,
      body: options.method === "GET" ? { items: [] } : watch,
    }),
  );
  assert.equal((await executeOperation(ctx, 0)).id, WATCH);
  assert.equal(ctx.calls[0].method, "GET");
  const call = mutation(ctx, "POST")[0];
  assert.equal(pathOf(call), `${projectPath}/database/watches`);
  assert.deepEqual(call.body, {
    environment: "dev",
    schema: "public",
    table: "orders",
    columns: ["id", "title"],
    operations: ["insert", "update"],
  });
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
});

test("watch delete removes only the selected watch with confirmation and idempotency", async () => {
  const ctx = context(
    {
      ...base,
      resource: "watch",
      operation: "delete",
      watchId: WATCH,
      confirmRemoval: true,
    },
    (options) => ({
      statusCode: 200,
      body:
        options.method === "GET"
          ? { items: [watch] }
          : { id: WATCH, deleted: true },
    }),
  );
  assert.equal((await executeOperation(ctx, 0)).deleted, true);
  const call = mutation(ctx, "DELETE")[0];
  assert.equal(pathOf(call), `${projectPath}/database/watches/${WATCH}`);
  assert.deepEqual(call.qs, { environment: "dev" });
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
});

test("webhook getMany omits destinations, custom headers, and one-time signing secrets", async () => {
  const ctx = context(
    { ...base, resource: "webhook", operation: "getMany" },
    { items: [webhook] },
  );
  const result = await executeOperation(ctx, 0);
  assert.equal(result[0].id, WEBHOOK);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-destination|private-receiver-header|private-signing-secret/,
  );
  assert.equal(pathOf(ctx.calls[0]), `${projectPath}/database/webhooks`);
  assert.deepEqual(ctx.calls[0].qs, { environment: "dev" });
});

test("webhook create puts environment in query, credentials outside the URL, and redacts secret output", async () => {
  const ctx = context(
    {
      ...base,
      resource: "webhook",
      operation: "create",
      url: webhook.url,
      eventTypes: '["data.orders"]',
    },
    webhook,
  );
  const result = await executeOperation(ctx, 0);
  const call = mutation(ctx, "POST")[0];
  assert.equal(pathOf(call), `${projectPath}/database/webhooks`);
  assert.deepEqual(call.qs, { environment: "dev" });
  assert.deepEqual(call.body, {
    url: webhook.url,
    event_types: ["data.orders"],
  });
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
  assert.equal(result.id, WEBHOOK);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-destination|private-receiver-header|private-signing-secret/,
  );
});

test("webhook test reports actual delivery fields and does not imply database event capture", async () => {
  const ctx = context(
    { ...base, resource: "webhook", operation: "test", webhookId: WEBHOOK },
    { delivered: true, status: 200, delivery_id: "dlv_test" },
  );
  assert.equal((await executeOperation(ctx, 0)).delivered, true);
  assert.equal(
    pathOf(ctx.calls[0]),
    `${projectPath}/database/webhooks/${WEBHOOK}/test`,
  );
  assert.deepEqual(ctx.calls[0].qs, { environment: "dev" });
});

test("webhook delete confirms one exact subscription and does not delete its watch", async () => {
  const ctx = context(
    {
      ...base,
      resource: "webhook",
      operation: "delete",
      webhookId: WEBHOOK,
      confirmRemoval: true,
    },
    (options) => ({
      statusCode: 200,
      body: options.method === "GET" ? webhook : { id: WEBHOOK, deleted: true },
    }),
  );
  assert.equal((await executeOperation(ctx, 0)).deleted, true);
  const call = mutation(ctx, "DELETE")[0];
  assert.equal(pathOf(call), `${projectPath}/database/webhooks/${WEBHOOK}`);
  assert.deepEqual(call.qs, { environment: "dev" });
  assert.ok(ctx.calls.every((c) => !pathOf(c).includes("/database/watches")));
});

test("export request uses the exact protected credential password only in the intended body", async () => {
  const ctx = context(
    { ...base, resource: "export", operation: "request" },
    () => ({
      statusCode: 202,
      body: {
        id: EXPORT,
        project_id: PROJECT,
        state: "queued",
        requested_at: at,
        next_request_at: "2026-01-02T00:00:00Z",
      },
    }),
  );
  const result = await executeOperation(ctx, 0);
  const call = mutation(ctx, "POST")[0];
  assert.equal(pathOf(call), `${projectPath}/exports`);
  assert.deepEqual(call.body, {
    password: "  retain these exact password bytes  ",
  });
  assert.equal(call.headers["Idempotency-Key"], base.idempotencyKey);
  assert.deepEqual(ctx.credentialReads, ["ohmyhostApi"]);
  assert.equal(result.state, "queued");
  assert.doesNotMatch(JSON.stringify(result), /password bytes|private-api-key/);
});

test("export get keeps a signed download URL out of output until explicitly enabled", async () => {
  for (const includeDownloadUrl of [false, true]) {
    const ctx = context(
      {
        ...base,
        resource: "export",
        operation: "get",
        exportId: EXPORT,
        includeDownloadUrl,
      },
      readyExport,
    );
    const result = await executeOperation(ctx, 0);
    assert.equal(pathOf(ctx.calls[0]), `${projectPath}/exports/${EXPORT}`);
    assert.equal(result.archive.bytes, 256);
    assert.equal("download_url" in result.archive, includeDownloadUrl);
  }
});

test("running and failed SQL write receipts stop the action and retain only safe operation metadata", async () => {
  for (const state of ["running", "failed"]) {
    const ctx = context(
      {
        ...base,
        resource: "database",
        operation: "write",
        statement: "DELETE FROM orders WHERE title=$1",
        parameters: '["private SQL value"]',
      },
      {
        state,
        operation_id: OPERATION,
        error: { code: "sql_failure", message: "private SQL value" },
        statement: "private SQL statement",
      },
    );
    await assert.rejects(executeOperation(ctx, 0), (error) => {
      assert.doesNotMatch(
        error.message,
        /private SQL value|private SQL statement/,
      );
      assert.doesNotMatch(
        JSON.stringify(error.receipt),
        /private SQL value|private SQL statement/,
      );
      if (error.receipt) assert.equal(error.receipt.operation_id, OPERATION);
      return true;
    });
  }
});

test("destructive watch/subscription removals require affirmative confirmation before any HTTP call", async () => {
  for (const [resource, idField, id] of [
    ["watch", "watchId", WATCH],
    ["webhook", "webhookId", WEBHOOK],
  ]) {
    const ctx = context(
      {
        ...base,
        resource,
        operation: "delete",
        [idField]: id,
        confirmRemoval: false,
      },
      {},
    );
    await assert.rejects(executeOperation(ctx, 0));
    assert.equal(ctx.calls.length, 0);
  }
});

test("an existing watch is not replaced implicitly, and missing export credentials never issue a request", async () => {
  const ctx = context(
    {
      ...base,
      resource: "watch",
      operation: "create",
      schema: "public",
      table: "orders",
      watchColumns: '["id"]',
      watchOperations: ["delete"],
      replaceExisting: false,
    },
    { items: [watch] },
  );
  await assert.rejects(executeOperation(ctx, 0));
  assert.equal(mutation(ctx, "POST").length, 0);
  const exportCtx = context(
    { ...base, resource: "export", operation: "request" },
    {},
    { apiKey: "private-api-key", zipPassword: "" },
  );
  await assert.rejects(executeOperation(exportCtx, 0));
  assert.equal(exportCtx.calls.length, 0);
});

test("invalid read/write schemas, environments, destinations and missing idempotency fail before HTTP", async () => {
  const invalid = [
    {
      resource: "database",
      operation: "query",
      statement: "INSERT INTO orders DEFAULT VALUES",
      parameters: "[]",
    },
    {
      resource: "database",
      operation: "query",
      statement: "SELECT $1",
      parameters: '[{"nested":true}]',
    },
    {
      resource: "database",
      operation: "write",
      statement: "CREATE TABLE forbidden (id int)",
      parameters: "[]",
    },
    {
      resource: "database",
      operation: "write",
      statement: "UPDATE orders SET title=$1",
      parameters: '["test"]',
      idempotencyKey: "",
    },
    {
      resource: "database",
      operation: "query",
      statement: "SELECT 1",
      parameters: "[]",
      environment: "staging",
    },
    {
      resource: "webhook",
      operation: "create",
      url: "http://receiver.example.invalid",
      eventTypes: '["data.orders"]',
    },
    {
      resource: "database",
      operation: "createTable",
      table: "orders",
      columns: '[{"name":"id","type":"money"}]',
    },
  ];
  for (const input of invalid) {
    const ctx = context({ ...base, ...input }, {});
    await assert.rejects(executeOperation(ctx, 0));
    assert.equal(ctx.calls.length, 0);
  }
});

test("API errors and redirects cannot echo credential-bearing upstream objects", async () => {
  for (const statusCode of [302, 401, 403, 500]) {
    const ctx = context({}, () => ({
      statusCode,
      body: { error: "private-upstream-error", token: "private-api-key" },
    }));
    await assert.rejects(request(ctx, "GET", "/v1/me"), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${statusCode}`));
      assert.doesNotMatch(
        error.message,
        /private-upstream-error|private-api-key/,
      );
      return true;
    });
  }
  const ctx = context({}, () => {
    throw {
      message: "private-api-key",
      request: { headers: { Authorization: "private-api-key" } },
    };
  });
  await assert.rejects(
    request(ctx, "GET", "/v1/me"),
    (error) => !error.message.includes("private-api-key"),
  );
  await assert.rejects(request(ctx, "GET", "//other.example.invalid/v1/me"));
});

test("project dropdown pagination follows exact API cursors and detects repeated cursors", async () => {
  const ctx = context({}, (options, count) => ({
    statusCode: 200,
    body:
      count === 1
        ? { items: [{ id: PROJECT, name: "First" }], next_cursor: CURSOR }
        : { items: [{ id: ORGANIZATION, name: "Second" }], next_cursor: null },
  }));
  assert.equal((await allProjects(ctx)).length, 2);
  assert.equal(ctx.calls[1].qs.cursor, CURSOR);
  const repeated = context({}, { items: [], next_cursor: CURSOR });
  await assert.rejects(
    allProjects(repeated),
    /repeating project pagination cursor/,
  );
});
