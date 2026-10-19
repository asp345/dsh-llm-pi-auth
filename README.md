# dsh-llm-pi-auth

dsh plugin that serves pi-ai provider routes with the credentials the pi coding agent keeps in its `auth.json`, and refreshes them into that same file.

## Why

`@deepseek-ai/dsh-llm-pi-ai` resolves a route's credential from the harness credential store; the pi coding agent stores the same credential in its own `auth.json`. Copying one into the other forks the OAuth refresh chain, because providers rotate the refresh token on use, so whichever side refreshes first invalidates the other.

This plugin gives dsh a `CredentialStore` backed by the pi file. pi-ai refreshes inside `CredentialStore.modify`, so the rotated pair lands in the `auth.json` the agent reads, and both processes resolve the same credential.

## Install

```bash
dsh plugin --profile web add github:asp345/dsh-llm-pi-auth
```

The lockfile pins the commit it resolved; a later commit needs `dsh plugin --profile web update dsh-llm-pi-auth`. For a local checkout, `link:/abs/path/to/dsh-llm-pi-auth` keeps the profile pointing at that directory.

The routes this plugin registers are owned by it, so `@deepseek-ai/dsh-llm-pi-ai` must stop declaring the same ids. Restate its row without them:

```yaml
# ~/.config/dsh/profiles/web/cordis.patch.yml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
```

Two adapters claiming one provider id fail registration with `DUPLICATE_ADAPTER`.

## Configuration

All keys are optional.

| Key | Default | Meaning |
| --- | --- | --- |
| `authPath` | `$PI_CODING_AGENT_DIR/auth.json`, else `~/.pi/agent/auth.json` | The pi credential file this plugin reads and rewrites. `~` expands. |
| `providers` | `["openai-codex", "anthropic"]` | pi-ai catalog provider ids to serve. |
| `displaySuffix` | `" (pi auth)"` | Appended to the catalog provider name for the model picker. |
| `lockTimeoutMs` | `5000` | Wait limit for the write lock around `auth.json`. |

```yaml
# ~/.config/dsh/profiles/web/cordis.patch.yml
- id: llm-pi-auth
  name: dsh-llm-pi-auth
  config:
    authPath: ~/.config/pi/auth.json
```

## File handling

- Reads are per request; nothing is cached in memory across requests.
- A write takes `<authPath>.lock`, re-reads the document, applies the mutation, then replaces the file through a temporary file and `rename` with mode `0600`. Entries other than the mutated provider id survive verbatim. The lock is reclaimed after 30 seconds if its holder died.
- pi-ai re-checks expiry inside `modify`, so a refresh another process already performed is observed instead of repeated. The pi agent does not take this lock; when it refreshes first, the re-read inside `modify` sees the rotated credential.
