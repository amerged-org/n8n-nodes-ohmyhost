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
- **SQL Export ZIP Password** is optional and needed only for requesting exports. It must have at least 12 characters (at most 1024 bytes). Choose and securely retain it. It cannot be recovered, and its exact bytes are significant. The password stays in the protected credential and is sent only in the export request body.

Terms used by the node: **Prod** is the live site, **Dev** is the Paid-only Development site, and a preview is a private live preview available on every plan. A Free workspace project has Prod only; a Paid workspace project can also have Dev.

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

**Project → Create** accepts a workspace, name, region, data mode, Dev access and **Include Dev Site** (on by default, matching the API). Turn it off to create a Prod-only project; Dev can be added later. The accepted answer contains the new project ID (`project_id`) and the operation ID (`id`); map the operation ID into **Operation → Get**.

Database, Database Watch and Database Webhook operations take an explicit **Environment**. Choose **Prod (Live Site)** for a Prod-only project, because **Dev (Paid-Only Development Site)** does not exist there.

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

Every logical mutation that accepts an idempotency key needs a stable unique key. This includes **Database Webhook → Test** and **Delete**, which the API requires a key for; a new key makes **Test** send another request. Reuse the same key and inputs after an uncertain response. When ohmyho.st refuses a request, the error shows its HTTP status, problem code, the problem `detail` (the `title` when there is no detail), the `suggested_action`, any retry delay and invalid field names, and the request ID. With Continue On Fail enabled, the same safe fields are added to the error item. Provider or engine exception contents and other response fields are never echoed.

A running or failed SQL write stops the node and provides the safe operation ID when available. Inspect **Operation → Get** before deciding what to do next. With Continue On Fail enabled, error output contains only a safe message and receipt identifiers, with input-item linking preserved.

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

Map the returned `id` into **Database Export → Get**. Leave **Include Download URL** off while polling `state` and `next_poll_after_seconds`. Once the archive is ready, run Get with **Include Download URL** enabled to create a fresh signed address. The node signs once per run when at least 24 hours of archive retention remain. The address is a bearer credential and can be stored in n8n execution history. When a signing request has an uncertain result, repeating the step creates another address.

For a ready archive, connect n8n's built-in **HTTP Request** node, GET `{{$json.archive.download_url}}`, choose **Authentication: None**, and return the response as a file/binary item. Do not send the ohmyho.st API key to the archive URL. The ZIP remains encrypted with the credential's user-chosen password.

## Compatibility and testing

Uses the [ohmyho.st API contract](https://ohmyho.st/api/openapi.json) as released in 0.1.77 and is built against `n8n-workflow` 2.16.0. Package code has no run-time dependencies beyond n8n's supplied workflow API, and does not access environment variables or the filesystem.

**Runtime:** Node.js 20.19 through 24.x (`>=20.19.0 <25`), matching the range n8n supports for community nodes. The compiled output targets ES2019 and uses no Node-specific APIs, so installing the package does not require Node.js 24.

**Development and release:** Node.js 24. The build, lint and release tooling (`@n8n/node-cli`, `release-it`) needs a newer Node.js than the published package does, and the GitHub Actions publish workflow runs on Node.js 24.

Build and lint use the official `@n8n/node-cli` tool. Tests cover routes, parameters, pagination, idempotency, credential isolation and sanitized errors. An isolated n8n 2.45.7 workflow listed projects through the live API. A separate native n8n 2.48.4 workflow ran **Database Export → Get** with signing enabled. The exact link from that run downloaded a ZIP whose checksum and authenticated AES decryption matched the test archive.

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

### 0.1.4

Align the node with ohmyho.st API 0.1.77.

- **Project → Create**: new **Include Dev Site** option (sent as `include_development_environment: false` when off) for Prod-only projects; the output now carries `project_id`.
- **Database Webhook → Test** and **Delete** send the Idempotency-Key header the API requires; they gain an **Idempotency Key** field.
- **Database Export → Request** checks the 12-character minimum ZIP password locally before any request.
- Errors show the API problem `detail` (or `title`), `suggested_action`, code, retry delay, invalid fields and request ID instead of only the HTTP status.
- Environment labels and texts use Dev (Paid-only Development site) and Prod (live site); Prod-only projects are documented.
- All other operations already matched the contract. The credential type and authentication are unchanged.

### 0.1.3

Give the node, dark-theme node and credential icons explicit 100×100 dimensions and a distinct high-contrast dark-theme node icon. No changes to operations, credentials or runtime behaviour.

### 0.1.2

Declare the supported Node.js range as `>=20.19.0 <25` instead of `>=24.0.0`, so the package installs under strict engine checks on Node.js 20.19 and 22. No changes to operations, credentials or runtime behaviour.

### 0.1.0

Initial release: 17 API operations, protected API/export credentials, real account selectors, and workflows using n8n's built-in Webhook and HTTP Request nodes.
