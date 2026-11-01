import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { cancelRun, readRun, startRun, workflowToken, type RunView } from "./services/withctx.ts";
import { addSummary, failStep, input, setOutput } from "./util/runner.ts";

const POLL_MS = 5_000;
/** Below the server's lease, so a job that can't reach withctx gives up before the run is taken for abandoned. */
const MAX_POLL_FAILURES = 12;
const MAX_CONTEXT = 100_000;

const FAILURES: Record<string, string> = {
  no_report: "The agent finished without reporting a result.",
  out_of_credit: "This organisation is out of credit.",
  not_deployed: "This agent isn't deployed yet.",
  turn_limit: "The agent reached its turn time limit.",
  stopped: "The agent's turn was stopped.",
  agent_gone: "This agent no longer exists.",
  agent_error: "The agent hit a problem and couldn't finish.",
  job_gone: "withctx stopped hearing from this job.",
};

const CANCELLED = { outcome: "cancelled", headline: "The run was cancelled." };

const ENDINGS: Partial<Record<RunView["status"], { outcome: string; headline: string }>> = {
  failed: { outcome: "fail", headline: "The agent reported failure." },
  timed_out: { outcome: "timed-out", headline: "The agent ran out of time." },
};

const contextFromFile = (path: string): string | undefined => {
  if (!path) {
    return undefined;
  }
  const text = readFileSync(path, "utf8");
  // The end of a log is where the failure is.
  return text.length > MAX_CONTEXT ? text.slice(-MAX_CONTEXT) : text;
};

const STATUS_LINES: Partial<Record<RunView["status"], string>> = {
  queued: "Queued behind another run of this agent",
  waiting_for_approval: "Waiting for approval",
  running: "Working",
};

async function follow(apiUrl: string, runId: string, token: string): Promise<RunView> {
  let lastLine = "";
  let failures = 0;
  for (;;) {
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

function finish(view: RunView): void {
  const summary = view.summary ?? "";
  const reason = view.failure ? (FAILURES[view.failure] ?? view.failure) : null;
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

async function main(): Promise<void> {
  const apiUrl = input("api-url").replace(/\/+$/, "");
  const identity = await workflowToken();
  const { runId, token } = await startRun(apiUrl, identity, {
    agent: input("agent"),
    prompt: input("prompt"),
    success: input("success") || undefined,
    context: contextFromFile(input("context-file")),
    pullRequest: input("pull-request") || undefined,
    timeoutMinutes: input("timeout-minutes") || "60",
  });
  console.log(`Started run ${runId}`);

  // GitHub signals a cancelled job, and the server's lease catches a runner that just dies.
  const cancel = () => {
    void cancelRun(apiUrl, runId, token).finally(() => process.exit(1));
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  finish(await follow(apiUrl, runId, token));
}

main().catch((err: unknown) => failStep((err as Error).message));
