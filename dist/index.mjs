// index.ts
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// services/withctx.ts
var AUDIENCE = "withctx";
var answerOf = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `withctx answered ${res.status}`);
  }
  return body;
};
async function workflowToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) {
    throw new Error("add `id-token: write` to this job's permissions so withctx can recognise the repository");
  }
  const res = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`GitHub wouldn't issue a workflow token (${res.status})`);
  }
  const { value } = await res.json();
  if (!value) {
    throw new Error("GitHub issued an empty workflow token");
  }
  return value;
}
async function startRun(apiUrl, identity, request) {
  const res = await fetch(`${apiUrl}/github/runs`, {
    method: "POST",
    headers: { authorization: `Bearer ${identity}`, "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  return answerOf(res);
}
async function readRun(apiUrl, runId, token) {
  const res = await fetch(`${apiUrl}/github/runs/${runId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  return answerOf(res);
}
async function cancelRun(apiUrl, runId, token) {
  await fetch(`${apiUrl}/github/runs/${runId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
}

// util/runner.ts
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
var input = (name) => process.env[`INPUT_${name.toUpperCase()}`]?.trim() ?? "";
var delimited = (name, value) => {
  const delimiter = `withctx_${randomUUID()}`;
  return `${name}<<${delimiter}
${value}
${delimiter}
`;
};
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, delimited(name, value));
  }
}
function addSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) {
    appendFileSync(file, `${markdown}
`);
  }
}
function failStep(message) {
  console.log(`::error::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  process.exitCode = 1;
}

// index.ts
var POLL_MS = 5000;
var MAX_POLL_FAILURES = 12;
var MAX_CONTEXT = 1e5;
var FAILURES = {
  no_report: "The agent finished without reporting a result.",
  out_of_credit: "This organisation is out of credit.",
  not_deployed: "This agent isn't deployed yet.",
  turn_limit: "The agent reached its turn time limit.",
  stopped: "The agent's turn was stopped.",
  agent_gone: "This agent no longer exists.",
  agent_error: "The agent hit a problem and couldn't finish.",
  job_gone: "withctx stopped hearing from this job."
};
var CANCELLED = { outcome: "cancelled", headline: "The run was cancelled." };
var ENDINGS = {
  failed: { outcome: "fail", headline: "The agent reported failure." },
  timed_out: { outcome: "timed-out", headline: "The agent ran out of time." }
};
var contextFromFile = (path) => {
  if (!path) {
    return;
  }
  const text = readFileSync(path, "utf8");
  return text.length > MAX_CONTEXT ? text.slice(-MAX_CONTEXT) : text;
};
var STATUS_LINES = {
  queued: "Queued behind another run of this agent",
  waiting_for_approval: "Waiting for approval",
  running: "Working"
};
async function follow(apiUrl, runId, token) {
  let lastLine = "";
  let failures = 0;
  for (;; ) {
    try {
      const view = await readRun(apiUrl, runId, token);
      failures = 0;
      const line = STATUS_LINES[view.status] ? `${STATUS_LINES[view.status]}${view.activity ? `: ${view.activity}` : ""}` : "";
      if (line && line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
      if (!STATUS_LINES[view.status]) {
        return view;
      }
    } catch (err) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        throw err;
      }
    }
    await sleep(POLL_MS);
  }
}
function finish(view) {
  const summary = view.summary ?? "";
  const reason = view.failure ? FAILURES[view.failure] ?? view.failure : null;
  if (summary) {
    addSummary(summary);
  }
  setOutput("summary", summary);
  if (view.status === "passed") {
    setOutput("outcome", "pass");
    console.log("The agent reported success.");
    return;
  }
  const { outcome, headline } = ENDINGS[view.status] ?? CANCELLED;
  setOutput("outcome", outcome);
  failStep(reason ?? headline);
}
async function main() {
  const apiUrl = input("api-url").replace(/\/+$/, "");
  const identity = await workflowToken();
  const { runId, token } = await startRun(apiUrl, identity, {
    agent: input("agent"),
    prompt: input("prompt"),
    success: input("success") || undefined,
    context: contextFromFile(input("context-file")),
    pullRequest: input("pull-request") || undefined,
    timeoutMinutes: input("timeout-minutes") || "60"
  });
  console.log(`Started run ${runId}`);
  const cancel = () => {
    cancelRun(apiUrl, runId, token).finally(() => process.exit(1));
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  finish(await follow(apiUrl, runId, token));
}
main().catch((err) => failStep(err.message));
