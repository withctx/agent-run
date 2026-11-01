# withctx agent run

Run a [withctx](https://withctx.com) agent in your GitHub workflow. The job passes or fails on what the agent reports.

There are no API keys to manage. GitHub proves which repository is calling, and your connected GitHub account tells withctx which organisation it belongs to.

## Before you start

1. In withctx, open **Settings › GitHub** and connect your GitHub account.
2. Open the agent's **GitHub** connection, connect it, and deploy the agent.

## Usage

```yaml
on: pull_request

permissions:
  contents: read
  id-token: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: withctx/agent-run@v1
        with:
          agent: review-bot
          prompt: Give this pull request a short review
          success: You reported what you found
```

`id-token: write` is required. It's how the action proves which repository it's running in.

### Run the agent only when something fails

```yaml
steps:
  - uses: actions/checkout@v5
  - run: npx eslint . > eslint.txt
  - if: failure()
    uses: withctx/agent-run@v1
    with:
      agent: lint-fixer
      prompt: Fix the ESLint failures on this pull request
      success: ESLint passes and behaviour hasn't changed
      context-file: eslint.txt
```

The agent runs on withctx, not on the GitHub runner, so `context-file` is how output from your job reaches it.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `agent` | Yes | The agent's slug, shown on its GitHub connection in withctx. |
| `prompt` | Yes | What the agent should do. |
| `success` | No | What counts as success. The agent reports pass or fail against this. |
| `context-file` | No | A file from this job to give the agent, such as a failing command's output. |
| `pull-request` | No | The pull request to work on, for workflows that don't run on one. |
| `timeout-minutes` | No | How long to wait, including time queued or waiting for approval. Defaults to 60. |

## Outputs

| Output | Description |
| --- | --- |
| `outcome` | `pass`, `fail`, `timed-out` or `cancelled`. |
| `summary` | What the agent said it did or found. |

## Good to know

- Tools needing approval work as they do in Slack, and the job shows "Waiting for approval" until someone decides.
- Agents can't be run from `pull_request_target` or `workflow_run` workflows.
- Pull requests from forks don't get the workflow identity this action needs, so it won't run on them.
