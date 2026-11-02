import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class OhmyhostApi implements ICredentialType {
  name = "ohmyhostApi";
  displayName = "ohmyho.st API";
  documentationUrl = "https://docs.ohmyho.st";
  icon = "file:ohmyhost.svg" as const;
  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      description:
        "Create an API key at https://app.ohmyho.st/tokens for the intended workspace",
    },
    {
      displayName: "SQL Export ZIP Password",
      name: "zipPassword",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description:
        "Optional. Required only to request encrypted SQL exports. Choose and securely retain the password; it cannot be recovered. See https://docs.ohmyho.st/backups.",
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: "https://app.ohmyho.st",
      url: "/v1/me",
      disableFollowRedirect: true,
      sendCredentialsOnCrossOriginRedirect: false,
      timeout: 30000,
    },
  };
}
