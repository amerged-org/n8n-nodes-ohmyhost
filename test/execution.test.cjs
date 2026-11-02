const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Ohmyhost } = require("../dist/nodes/Ohmyhost/Ohmyhost.node.js");
const { executeOperation } = require("../dist/nodes/Ohmyhost/Operations.js");
const project = "01M00000000000000000000001";
const operationId = "01M00000000000000000000005";
function execution(params, body, continued = false, inputs = 1) {
  return {
    getInputData: () => Array.from({ length: inputs }, () => ({ json: {} })),
    getNodeParameter: (name, _index, fallback) =>
      Object.hasOwn(params, name) ? params[name] : fallback,
    getNode: () => ({
      id: "example-node",
      name: "ohmyho.st",
      type: "@amerged/n8n-nodes-ohmyhost.ohmyhost",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    continueOnFail: () => continued,
    helpers: {
      async httpRequestWithAuthentication() {
        return { body, statusCode: 200 };
      },
    },
  };
}

test("execute preserves paired input indexes for every project result", async () => {
  const ctx = execution(
    { resource: "project", operation: "getMany", limit: 10 },
    { items: [{ id: project }, { id: "01M00000000000000000000002" }] },
    false,
    2,
  );
  const [items] = await new Ohmyhost().execute.call(ctx);
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => item.pairedItem),
    [{ item: 0 }, { item: 0 }, { item: 1 }, { item: 1 }],
  );
});

test("default failed or pending SQL errors expose only their safe operation receipt", async () => {
  const ctx = execution(
    {
      resource: "database",
      operation: "write",
      projectId: project,
      environment: "dev",
      statement: "INSERT INTO orders(title) VALUES ($1)",
      parameters: ["synthetic-value"],
      idempotencyKey: "stable-key",
    },
    {
      state: "running",
      operation_id: operationId,
      error: { message: "private-provider-response private-api-key" },
    },
  );
  await assert.rejects(new Ohmyhost().execute.call(ctx), (error) => {
    assert.equal(error.constructor.name, "NodeOperationError");
    assert.match(error.message, new RegExp(operationId));
    assert.doesNotMatch(
      JSON.stringify(error),
      /private-provider-response|private-api-key/,
    );
    return true;
  });
});

test("Continue On Fail does not echo arbitrary engine or provider exception contents", async () => {
  const ctx = execution({}, {}, true);
  ctx.getNodeParameter = () => {
    throw new Error("private-api-key private-SQL-parameter");
  };
  const [[item]] = await new Ohmyhost().execute.call(ctx);
  assert.equal(
    item.json.error,
    "The operation did not complete. Check its inputs and connection.",
  );
  assert.deepEqual(item.pairedItem, { item: 0 });
  assert.doesNotMatch(
    JSON.stringify(item),
    /private-api-key|private-SQL-parameter/,
  );
});

test("watch preflight reuses an identical set even when the API normalizes column/change order", async () => {
  let calls = 0;
  const watch = {
    id: "pgcf_watch_01234567",
    schema: "public",
    table: "orders",
    columns: ["title", "id"],
    operations: ["update", "insert"],
  };
  const ctx = execution(
    {
      resource: "watch",
      operation: "create",
      projectId: project,
      environment: "dev",
      schema: "public",
      table: "orders",
      watchColumns: ["id", "title"],
      watchOperations: ["insert", "update"],
      idempotencyKey: "stable-watch",
    },
    { items: [watch] },
  );
  ctx.helpers.httpRequestWithAuthentication = async (_credential, options) => {
    calls++;
    assert.equal(options.method, "GET");
    return { body: { items: [watch] }, statusCode: 200 };
  };
  assert.deepEqual(await executeOperation(ctx, 0), watch);
  assert.equal(calls, 1);
});

test("the valid empty primary-key JSON default omits the optional API field", async () => {
  const ctx = execution(
    {
      resource: "database",
      operation: "createTable",
      projectId: project,
      environment: "dev",
      table: "notes",
      columns: [{ name: "title", type: "text" }],
      primaryKey: "[]",
      idempotencyKey: "stable-table",
    },
    { created: true },
  );
  ctx.helpers.httpRequestWithAuthentication = async (_credential, options) => {
    assert.equal(Object.hasOwn(options.body, "primary_key"), false);
    return { body: { created: true }, statusCode: 200 };
  };
  assert.equal((await executeOperation(ctx, 0)).created, true);
});
