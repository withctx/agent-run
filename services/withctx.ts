const AUDIENCE = "withctx";

export type RunStatus = "queued" | "running" | "waiting_for_approval" | "passed" | "failed" | "timed_out" | "cancelled";

export interface RunView {
  status: RunStatus;
  summary: string | null;
  failure: string | null;
  activity: string | null;
}

export interface StartRequest {
  agent: string;
  prompt: string;
  success?: string;
  context?: string;
  pullRequest?: string;
  timeoutMinutes: string;
}

const answerOf = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `withctx answered ${res.status}`);
  }
  return body;
};

/** Proof of which repository this job belongs to. It's the only credential the action needs. */
export async function workflowToken(): Promise<string> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) {
    throw new Error("add `id-token: write` to this job's permissions so withctx can recognise the repository");
  }
  const res = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`GitHub wouldn't issue a workflow token (${res.status})`);
  }
  const { value } = (await res.json()) as { value?: string };
  if (!value) {
    throw new Error("GitHub issued an empty workflow token");
  }
  return value;
}

export async function startRun(apiUrl: string, identity: string, request: StartRequest): Promise<{ runId: string; token: string }> {
  const res = await fetch(`${apiUrl}/github/runs`, {
    method: "POST",
    headers: { authorization: `Bearer ${identity}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return answerOf(res);
}

export async function readRun(apiUrl: string, runId: string, token: string): Promise<RunView> {
  const res = await fetch(`${apiUrl}/github/runs/${runId}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  return answerOf(res);
}

export async function cancelRun(apiUrl: string, runId: string, token: string): Promise<void> {
  await fetch(`${apiUrl}/github/runs/${runId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
}
