# @amerged/n8n-nodes-ohmyhost

An n8n community node for [ohmyho.st](https://ohmyho.st). Connect projects and their managed PostgreSQL databases to n8n workflows, including SQL CRUD, direct table creation, database event subscriptions, and password-encrypted SQL exports.

This package contains one **ohmyho.st** action node and an **ohmyho.st API** credential. Use n8n's built-in Webhook node to receive events from hosted apps or database subscriptions. There is no duplicate custom Webhook trigger.

## Installation

On a self-hosted n8n instance with community packages enabled, open **Settings → Community Nodes → Install** and enter:

```
@amerged/n8n-nodes-ohmyhost
```

Follow the [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/). npm publication and n8n verification are separate: this package does not claim verified status or availability in n8n Cloud. Cloud discovery requires n8n's Creator Portal verification.

## Credentials

Create an API key for the intended account/workspace at [ohmyho.st API Tokens](https://app.ohmyho.st/tokens), then add an **ohmyho.st API** credential in n8n:

- **API Key** is required. Authentication is sent only in the Authorization header to the fixed `https://app.ohmyho.st` API.
- **SQL Export ZIP Password** is optional and needed only for requesting exports. Choose and securely retain it. It cannot be recovered, and its exact bytes are significant. The password stays in the protected credential and is sent only in the export request body.

Permissions, membership, database row-level security, project budgets, and applicable service limits continue to apply. Database writes and export requests require the appropriate Owner authorization. Requests can wake database compute and incur usage charges.

## Operations

| Resource         | Operations                                         |
| ---------------- | -------------------------------------------------- |
| Project          | Get Many, Get, Get Status, Create                  |
| Operation        | Get asynchronous operation status                  |
| Database         | Run Read-Only SQL, Execute SQL Write, Create Table |
| Database Watch   | Get Many, Create or explicitly replace, Delete     |
| Database Webhook | Get Many, Create, Test, Delete                     |
| Database Export  | Request, Get status and optional download URL      |

Project and workspace selectors load real account data. Watch and webhook selectors depend on the selected project and environment. IDs can also be mapped with expressions. Operation and export IDs should be mapped from their preceding receipt; the targeted API contract has no history-list endpoints for these resources.

### SQL CRUD and table creation

Choose **Database → Run Read-Only SQL** for one SELECT/WITH statement. Use `$1`, `$2`, etc. for values, and provide a JSON parameters array. Reads accept up to 50 scalar JSON values and return one receipt item containing `rows`, `row_count`, and `truncated`; use n8n's Split Out node if each row should become an item.

Choose **Execute SQL Write** for one INSERT, UPDATE, DELETE, or INSERT ... ON CONFLICT statement. Write parameters may contain JSON objects and arrays, within the API's depth/size limits. Schema changes use **Create Table**, which takes column definitions directly, for example:

```json
[
  { "name": "id", "type": "bigint", "identity": true, "nullable": false },
  { "name": "title", "type": "text" },
  { "name": "created_at", "type": "timestamptz", "default": "now" }
]
```

The primary key can be `["id"]`, or omitted. Identical existing definitions succeed; conflicting definitions fail. Other schema changes continue to use migrations.

Every logical mutation that accepts an idempotency key needs a stable unique key. Reuse the same key and inputs after an uncertain response. A running or failed SQL write stops the node and provides the safe operation ID when available. Inspect **Operation → Get** before deciding what to do next. With Continue On Fail enabled, error output contains only a safe message and receipt identifiers, with input-item linking preserved.

### Hosted app webhook → SQL workflow

1. Add n8n's built-in **Webhook** node, choose HTTP POST and publish the workflow to obtain its production URL.
2. Configure your hosted app to POST JSON to that address. Declare the receiver's origin in the app's outbound network policy where required.
3. Connect an **ohmyho.st** node and map the Webhook body into parameterized SQL values. For example, map `{{$json.body.event_id}}` into the idempotency key and bind application values through the parameters array.

Use stable sender event IDs so retries reuse the same write key. The generic receiver URL is a bearer secret; the connector does not add signature verification or authentication to n8n's built-in Webhook node.

### Database events

Create a **Database Watch** for an existing table, explicitly selecting the columns and changes to publish. An identical watch can be reused. Replacing a different watch requires an explicit option because other automations may depend on it. The preflight check and replacement are separate requests, so concurrent changes cannot be excluded.

Create a **Database Webhook** with the returned `event_type` and the production URL of an n8n Webhook node. A watch and subscription are separate resources. The connector omits one-time signing secrets, receiver URLs, and custom header values from webhook output. Private destination URLs can still appear in workflow configuration or execution inputs.

**Test** sends a synthetic delivery. To prove a real database event, insert a uniquely marked test row and verify that the matching event reaches the receiver. Deletion requires confirmation and removes the selected watch or subscription, not the table. Removing a table watch stops that table's events for all subscribers.

### Encrypted SQL exports

**Request** creates an asynchronous password-encrypted SQL ZIP for the project's assigned Dev/Prod databases. One accepted request per project per rolling 24 hours is allowed, including failed exports. Retain the same idempotency key after uncertainty. The archive does not contain application source, files, secrets, or configuration.

Map the returned `id` into **Database Export → Get**. Follow `state` and `next_poll_after_seconds`. A queued/running receipt is not a ready download. Enable **Include Download URL** only for downstream download; the signed bearer address is omitted by default and can be stored in n8n execution history when enabled.

For a ready archive, connect n8n's built-in **HTTP Request** node, GET `{{$json.archive.download_url}}`, choose **Authentication: None**, and return the response as a file/binary item. Do not send the ohmyho.st API key to the archive URL. The ZIP remains encrypted with the credential's user-chosen password.

## Compatibility and testing

Developed against the [ohmyho.st API 0.1.46 contract](https://ohmyho.st/releases/0.1.46/openapi.json), `n8n-workflow` 2.16.0, Node.js 24, and n8n 2.45.7. Package code has no run-time dependencies beyond n8n's supplied workflow API, and does not access environment variables or the filesystem.

Build and lint use the official `@n8n/node-cli` tool. Tests cover exact routes, query/body placement, SQL write receipts, parameter validation, idempotency, pagination, subscription confirmation, credential isolation, and error/output redaction. A real isolated n8n 2.45.7 Manual Trigger → ohmyho.st Get Many Projects workflow has also been exercised against the live API; SQL writes, database event delivery, and ZIP download are separate live checks and are not claimed by that read test.

```sh
npm ci
npm test
npm run lint
```

Release through the repository's GitHub Actions workflow with npm provenance. n8n Creator Portal verification requires that distribution route; publishing directly from a local machine does not meet its verification requirements.

## Resources

- [ohmyho.st documentation](https://docs.ohmyho.st)
- [API tokens](https://app.ohmyho.st/tokens)
- [Database export documentation](https://docs.ohmyho.st/backups)
- [Source and issues](https://github.com/amerged-org/n8n-nodes-ohmyhost)
- [n8n community nodes](https://docs.n8n.io/integrations/community-nodes/)

## Version history

### 0.1.0

Initial release: 17 API operations, protected API/export credentials, real account selectors, and workflows using n8n's built-in Webhook and HTTP Request nodes.
