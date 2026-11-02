const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  OhmyhostApi,
} = require("../dist/credentials/OhmyhostApi.credentials.js");

test("credentials protect API key and ZIP password and inject only bearer authentication", () => {
  const credential = new OhmyhostApi();
  assert.equal(credential.name, "ohmyhostApi");
  const token = credential.properties.find((p) => p.name === "apiKey");
  const password = credential.properties.find((p) => p.name === "zipPassword");
  assert.equal(token.required, true);
  assert.equal(token.typeOptions.password, true);
  assert.equal(token.default, "");
  assert.equal(password.typeOptions.password, true);
  assert.notEqual(password.required, true);
  assert.equal(password.default, "");
  assert.deepEqual(Object.keys(credential.authenticate.properties), [
    "headers",
  ]);
  assert.deepEqual(Object.keys(credential.authenticate.properties.headers), [
    "Authorization",
  ]);
  assert.match(
    credential.authenticate.properties.headers.Authorization,
    /Bearer/,
  );
  assert.doesNotMatch(JSON.stringify(credential.authenticate), /zipPassword/);
});

test("credential testing targets only the production identity endpoint without following redirects", () => {
  const { request } = new OhmyhostApi().test;
  assert.equal(request.baseURL, "https://app.ohmyho.st");
  assert.equal(request.url, "/v1/me");
  assert.equal(request.disableFollowRedirect, true);
  assert.equal(request.sendCredentialsOnCrossOriginRedirect, false);
  assert.ok(request.timeout <= 30000);
});
