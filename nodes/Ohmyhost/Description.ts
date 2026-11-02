import type { INodeProperties } from "n8n-workflow";

const projectSelector: INodeProperties = {
  displayName: "Project Name or ID",
  name: "projectId",
  type: "options",
  default: "",
  required: true,
  typeOptions: { loadOptionsMethod: "getProjects" },
  description:
    'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
};
const idem: INodeProperties = {
  displayName: "Idempotency Key",
  name: "idempotencyKey",
  type: "string",
  default: "",
  required: true,
  description:
    "Stable unique key for one logical mutation; retain the same key and inputs after an uncertain result",
};
const op = (name: string, value: string, action: string) => ({
  name,
  value,
  action,
  description: action,
});
function operations(
  resource: string,
  options: ReturnType<typeof op>[],
  defaultValue: string,
): INodeProperties {
  return {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    default: defaultValue,
    displayOptions: { show: { resource: [resource] } },
    options,
  };
}
const json = (
  displayName: string,
  name: string,
  description: string,
  resource: string[],
  operation: string[],
  defaultValue = "[]",
  required = true,
): INodeProperties => ({
  displayName,
  name,
  type: "json",
  default: defaultValue,
  required,
  description,
  displayOptions: { show: { resource, operation } },
});

export const properties: INodeProperties[] = [
  {
    displayName: "Resource",
    name: "resource",
    type: "options",
    noDataExpression: true,
    default: "project",
    options: [
      { name: "Database", value: "database" },
      { name: "Database Export", value: "export" },
      { name: "Database Watch", value: "watch" },
      { name: "Database Webhook", value: "webhook" },
      { name: "Operation", value: "operation" },
      { name: "Project", value: "project" },
    ],
  },
  operations(
    "project",
    [
      op("Create", "create", "Create a project"),
      op("Get", "get", "Get a project"),
      op("Get Many", "getMany", "Get many projects"),
      op("Get Status", "status", "Get project status"),
    ],
    "getMany",
  ),
  operations(
    "operation",
    [op("Get", "get", "Get an asynchronous operation")],
    "get",
  ),
  operations(
    "database",
    [
      op("Create Table", "createTable", "Create a database table"),
      op("Execute SQL Write", "write", "Execute a SQL write"),
      op("Run Read-Only SQL", "query", "Run a read-only SQL query"),
    ],
    "query",
  ),
  operations(
    "watch",
    [
      op("Create", "create", "Create a database table watch"),
      op("Delete", "delete", "Delete a database table watch"),
      op("Get Many", "getMany", "Get many database table watches"),
    ],
    "getMany",
  ),
  operations(
    "webhook",
    [
      op("Create", "create", "Create a database webhook"),
      op("Delete", "delete", "Delete a database webhook"),
      op("Get Many", "getMany", "Get many database webhooks"),
      op("Test", "test", "Test a database webhook"),
    ],
    "getMany",
  ),
  operations(
    "export",
    [
      op("Get", "get", "Get encrypted SQL export status"),
      op("Request", "request", "Request an encrypted SQL export"),
    ],
    "get",
  ),
  {
    ...projectSelector,
    displayOptions: {
      show: { resource: ["database", "watch", "webhook", "export"] },
    },
  },
  {
    ...projectSelector,
    displayOptions: {
      show: { resource: ["project"], operation: ["get", "status"] },
    },
  },
  {
    displayName: "Environment",
    name: "environment",
    type: "options",
    required: true,
    default: "dev",
    options: [
      { name: "Dev", value: "dev" },
      { name: "Prod", value: "prod" },
    ],
    displayOptions: { show: { resource: ["database", "watch", "webhook"] } },
    description: "Application database environment",
  },
  {
    displayName: "Return All",
    name: "returnAll",
    type: "boolean",
    default: false,
    displayOptions: { show: { resource: ["project"], operation: ["getMany"] } },
    description: "Whether to return all results or only up to a given limit",
  },
  {
    displayName: "Limit",
    name: "limit",
    type: "number",
    default: 50,
    typeOptions: { minValue: 1, maxValue: 100 },
    displayOptions: {
      show: {
        resource: ["project"],
        operation: ["getMany"],
        returnAll: [false],
      },
    },
    description: "Max number of results to return",
  },
  {
    displayName: "Workspace Name or ID",
    name: "organizationId",
    type: "options",
    default: "",
    required: true,
    typeOptions: { loadOptionsMethod: "getWorkspaces" },
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
    description:
      'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
  },
  {
    displayName: "Project Name",
    name: "projectName",
    type: "string",
    default: "",
    required: true,
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
  },
  {
    displayName: "Region",
    name: "region",
    type: "options",
    default: "us",
    required: true,
    options: [
      { name: "EU", value: "eu" },
      { name: "US", value: "us" },
    ],
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
    description: "Hosting region selected when creating the project",
  },
  {
    displayName: "Data Mode",
    name: "dataMode",
    type: "options",
    default: "isolated",
    options: [
      { name: "Isolated Dev and Prod", value: "isolated" },
      { name: "Shared Dev and Prod", value: "shared" },
    ],
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
  },
  {
    displayName: "Dev Access",
    name: "devAccessMode",
    type: "options",
    default: "protected",
    options: [
      { name: "Protected", value: "protected" },
      { name: "Public", value: "public" },
    ],
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
  },
  {
    displayName:
      "Project creation starts provisioning. Use Operation → Get to verify completion; it does not deploy an application.",
    name: "projectCreationNotice",
    type: "notice",
    default: "",
    displayOptions: { show: { resource: ["project"], operation: ["create"] } },
  },
  {
    displayName: "Operation ID",
    name: "operationId",
    type: "string",
    default: "",
    required: true,
    displayOptions: { show: { resource: ["operation"] } },
    description:
      "Map the operation ID returned by a previous asynchronous request",
  },
  {
    ...idem,
    displayOptions: {
      show: { resource: ["project", "watch"], operation: ["create", "delete"] },
    },
  },
  {
    ...idem,
    displayOptions: {
      show: { resource: ["database"], operation: ["write", "createTable"] },
    },
  },
  {
    ...idem,
    displayOptions: { show: { resource: ["webhook"], operation: ["create"] } },
  },
  {
    ...idem,
    displayOptions: { show: { resource: ["export"], operation: ["request"] } },
  },
  {
    displayName: "SQL Statement",
    name: "statement",
    type: "string",
    default: "",
    required: true,
    typeOptions: { rows: 6 },
    displayOptions: {
      show: { resource: ["database"], operation: ["query", "write"] },
    },
    description:
      "One statement; use $1, $2, etc. for parameter values. Read supports SELECT/WITH; write supports INSERT/UPDATE/DELETE.",
  },
  json(
    "Parameters",
    "parameters",
    "JSON array matching the SQL placeholders; write parameters may include JSON objects",
    ["database"],
    ["query", "write"],
  ),
  {
    displayName: "Table",
    name: "table",
    type: "string",
    default: "",
    required: true,
    displayOptions: {
      show: {
        resource: ["database", "watch"],
        operation: ["createTable", "create"],
      },
    },
    description: "Application table name",
  },
  json(
    "Columns",
    "columns",
    "Array of column objects with name, type and optional nullable, identity, default (now or uuid)",
    ["database"],
    ["createTable"],
    '[{"name":"id","type":"bigint","identity":true,"nullable":false},{"name":"title","type":"text"}]',
  ),
  json(
    "Primary Key",
    "primaryKey",
    "Optional array of column names; use [] for no primary key",
    ["database"],
    ["createTable"],
    "[]",
    false,
  ),
  {
    displayName: "Schema",
    name: "schema",
    type: "string",
    default: "public",
    displayOptions: { show: { resource: ["watch"], operation: ["create"] } },
  },
  json(
    "Published Columns",
    "watchColumns",
    "Array of explicitly selected column names that may be included in database events",
    ["watch"],
    ["create"],
  ),
  {
    displayName: "Changes",
    name: "watchOperations",
    type: "multiOptions",
    default: ["insert", "update", "delete"],
    options: [
      { name: "Delete", value: "delete" },
      { name: "Insert", value: "insert" },
      { name: "Update", value: "update" },
    ],
    displayOptions: { show: { resource: ["watch"], operation: ["create"] } },
  },
  {
    displayName: "Replace Existing Watch",
    name: "replaceExisting",
    type: "boolean",
    default: false,
    displayOptions: { show: { resource: ["watch"], operation: ["create"] } },
    description:
      "Whether to allow replacing a different watch, affecting every subscriber of that table",
  },
  {
    displayName: "Watch Name or ID",
    name: "watchId",
    type: "options",
    default: "",
    required: true,
    typeOptions: {
      loadOptionsMethod: "getWatches",
      loadOptionsDependsOn: ["projectId", "environment"],
    },
    displayOptions: { show: { resource: ["watch"], operation: ["delete"] } },
    description:
      'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
  },
  {
    displayName: "Webhook Name or ID",
    name: "webhookId",
    type: "options",
    default: "",
    required: true,
    typeOptions: {
      loadOptionsMethod: "getWebhooks",
      loadOptionsDependsOn: ["projectId", "environment"],
    },
    displayOptions: {
      show: { resource: ["webhook"], operation: ["test", "delete"] },
    },
    description:
      'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
  },
  {
    displayName: "Confirm Removal",
    name: "confirmRemoval",
    type: "boolean",
    default: false,
    required: true,
    displayOptions: {
      show: { resource: ["watch", "webhook"], operation: ["delete"] },
    },
    description:
      "Whether you reviewed this exact resource and authorize stopping its event deliveries",
  },
  {
    displayName: "HTTPS Receiver URL",
    name: "url",
    type: "string",
    default: "",
    required: true,
    typeOptions: { password: true },
    displayOptions: { show: { resource: ["webhook"], operation: ["create"] } },
    description:
      "Receiver URL, such as the production URL of an n8n Webhook node; private URLs may be retained in workflow inputs",
  },
  json(
    "Event Types",
    "eventTypes",
    'Array of database event types, for example ["data.orders"] or ["data.*"]',
    ["webhook"],
    ["create"],
    '["data.*"]',
  ),
  {
    displayName: "Export ID",
    name: "exportId",
    type: "string",
    default: "",
    required: true,
    displayOptions: { show: { resource: ["export"], operation: ["get"] } },
    description: "Map the ID returned by Request Encrypted SQL Export",
  },
  {
    displayName: "Include Download URL",
    name: "includeDownloadUrl",
    type: "boolean",
    default: false,
    displayOptions: { show: { resource: ["export"], operation: ["get"] } },
    description:
      "Whether to return the sensitive signed archive URL for a downstream HTTP download; it may be stored in execution history",
  },
  {
    displayName:
      "An accepted export uses the project’s one-request-per-24-hours allowance, including failed exports. Set and retain your ZIP password in the credential.",
    name: "exportNotice",
    type: "notice",
    default: "",
    displayOptions: { show: { resource: ["export"], operation: ["request"] } },
  },
];
