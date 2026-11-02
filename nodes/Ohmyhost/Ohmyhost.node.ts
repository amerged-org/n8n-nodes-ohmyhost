import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { properties } from "./Description";
import {
  allProjects,
  environment,
  record,
  request,
  rows,
  SafeError,
  ulid,
} from "./GenericFunctions";
import { executeOperation } from "./Operations";

function choice(
  context: ILoadOptionsFunctions,
  id: unknown,
  name: unknown,
): INodePropertyOptions {
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim())
    throw new NodeOperationError(
      context.getNode(),
      "Unexpected selection list from ohmyho.st",
    );
  return { name, value: id };
}
export class Ohmyhost implements INodeType {
  description: INodeTypeDescription = {
    displayName: "ohmyho.st",
    name: "ohmyhost",
    icon: { light: "file:ohmyhost.svg", dark: "file:ohmyhost.dark.svg" },
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      "Manage ohmyho.st projects, PostgreSQL data, database events and encrypted SQL exports",
    defaults: { name: "ohmyho.st" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "ohmyhostApi", required: true }],
    properties,
  };
  methods = {
    loadOptions: {
      async getProjects(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        return (await allProjects(this)).map((p) => choice(this, p.id, p.name));
      },
      async getWorkspaces(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const data = await request(this, "GET", "/v1/me");
        if (
          !Array.isArray(data.organizations) ||
          data.organizations.some((o) => !record(o))
        )
          throw new NodeOperationError(
            this.getNode(),
            "Unexpected workspace list from ohmyho.st",
          );
        return data.organizations.map((o) => {
          const org = o as Record<string, unknown>;
          return choice(this, org.id, org.name);
        });
      },
      async getWatches(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const projectId = this.getCurrentNodeParameter("projectId");
        const selected = this.getCurrentNodeParameter("environment");
        if (!projectId || !selected) return [];
        const items = rows(
          await request(
            this,
            "GET",
            `/v1/projects/${ulid(projectId, "project ID")}/database/watches`,
            undefined,
            { environment: environment(selected) },
          ),
        );
        return items.map((w) =>
          choice(
            this,
            w.id,
            `${String(w.schema)}.${String(w.table)} (${String(w.id)})`,
          ),
        );
      },
      async getWebhooks(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const projectId = this.getCurrentNodeParameter("projectId");
        const selected = this.getCurrentNodeParameter("environment");
        if (!projectId || !selected) return [];
        const items = rows(
          await request(
            this,
            "GET",
            `/v1/projects/${ulid(projectId, "project ID")}/database/webhooks`,
            undefined,
            { environment: environment(selected) },
          ),
        );
        return items.map((w) =>
          choice(
            this,
            w.id,
            `${String(w.id)} (${Array.isArray(w.event_types) ? w.event_types.join(", ") : "database events"})`,
          ),
        );
      },
    },
  };
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const input = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let index = 0; index < input.length; index++) {
      try {
        const result = await executeOperation(this, index);
        for (const json of Array.isArray(result) ? result : [result])
          output.push({
            json: json as IDataObject,
            pairedItem: { item: index },
          });
      } catch (error) {
        const message =
          error instanceof SafeError
            ? error.message
            : "The operation did not complete. Check its inputs and connection.";
        if (this.continueOnFail()) {
          output.push({
            json: {
              error: message,
              ...(error instanceof SafeError ? error.receipt : {}),
            },
            pairedItem: { item: index },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), message, {
          itemIndex: index,
        });
      }
    }
    return [output];
  }
}
