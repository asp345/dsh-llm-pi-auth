# dsh-llm-pi-auth

DSH plugin that serves pi-ai provider routes with the credentials the pi coding agent keeps in its `auth.json`, and refreshes them into that same file.

## Why

`@deepseek-ai/dsh-llm-pi-ai` resolves a route's credential from the harness credential store (`llm-pi-ai/<provider id>` records in `$DSH_HOME/.credentials.yaml`). The pi coding agent stores the same kind of credential, one per provider id, in `<agent-dir>/auth.json`. Neither side reads the other's file, so a machine signed in to pi cannot use those tokens in dsh without copying them, and a copy forks the OAuth refresh chain: OpenCode rotates the refresh token on use, so whichever side refreshes first invalidates the other.

This plugin gives dsh a `CredentialStore` backed by the pi file. pi-ai runs OAuth refresh inside `CredentialStore.modify`, so the rotated pair lands in the same `auth.json` the pi agent reads. Both processes then resolve the same credential, and a token refreshed by either one stays valid for the other.

## Requirements

- dsh 0.2.x. Peers carry no version range, so the loader accepts any dsh that resolves them; the profile that this package was tested against is 0.2.0-rc.2 and 0.2.1-rc.2.
- A pi coding agent credential file, by default `<agent-dir>/auth.json` where the agent directory is `$PI_CODING_AGENT_DIR` or `~/.pi/agent`

## Model catalog

A route serves exactly the models of the pi-ai catalog dsh ships, because the provider objects come from dsh's own installation rather than from this package. The catalog therefore moves with dsh:

| dsh | `@earendil-works/pi-ai` | `openai-codex` models |
| --- | --- | --- |
| 0.2.0-rc.2 | ^0.87.1 | GPT-5.3 Codex Spark, GPT-5.5, GPT-5.6 Luna/Sol/Terra, GPT-6 Astra/Luna/Sol |
| 0.2.1-rc.2 | ^1.1.0 | the same set plus GPT-6.1 Sol, and whatever else pi-ai 1.x adds |

A model missing from the catalog cannot be reached by editing this plugin's config; the upgrade path is a dsh whose pinned pi-ai carries it.

## Install

The package declares a profile bundle (`dsh.bundle.patch`), so the loader row is inserted on install.

```bash
dsh plugin --profile web add link:/abs/path/to/dsh-llm-pi-auth
```

`link:` keeps the profile pointing at this working copy; `file:` copies the package into the profile and needs a reinstall after every edit.

The routes this plugin registers are owned by this plugin, so `@deepseek-ai/dsh-llm-pi-ai` must stop declaring the same ids in its `providers` dict. Restate the profile's `llm-pi-ai` row without them:

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

Two adapters claiming one provider id fail registration with `DUPLICATE_ADAPTER`. With both rows present and the same ids configured, the second claimant refuses to load.

## Configuration

All keys are optional.

| Key | Default | Meaning |
| --- | --- | --- |
| `authPath` | `$PI_CODING_AGENT_DIR/auth.json`, else `~/.pi/agent/auth.json` | The pi credential file this plugin reads and rewrites. `~` expands. |
| `providers` | `["openai-codex", "anthropic"]` | pi-ai catalog provider ids to serve. Each id must exist in the installed pi-ai catalog. |
| `displaySuffix` | `" (pi auth)"` | Appended to the catalog provider name for the model picker. |
| `lockTimeoutMs` | `5000` | Wait limit for the write lock around `auth.json`. |

Example row, when the default path does not match the machine:

```yaml
# ~/.config/dsh/profiles/web/cordis.patch.yml
- id: llm-pi-auth
  name: dsh-llm-pi-auth
  config:
    authPath: ~/.config/pi/auth.json
    providers:
      - openai-codex
      - anthropic
```

## How the file is handled

- Reads are per request; nothing is cached in memory across requests.
- A write takes `<authPath>.lock` exclusively, re-reads the document, applies the mutation, then replaces the file through a temporary file and `rename` with mode `0600`. Entries other than the mutated provider id survive verbatim.
- The lock is reclaimed after 30 seconds if its holder died.
- pi-ai's refresh path re-checks expiry inside `modify`, so a refresh that another process already performed is observed instead of repeated. The pi agent does not take this lock; when it refreshes first, this plugin's re-read inside `modify` sees the rotated credential.

## Credential shapes

`auth.json` holds one credential per provider id, in pi-ai's own `Credential` union, which is exactly what this store returns:

```json
{
  "openai-codex": { "type": "oauth", "access": "eyJ...", "refresh": "rft_...", "expires": 1790000000000, "accountId": "..." },
  "anthropic": { "type": "oauth", "access": "sk-ant-oat01-...", "refresh": "...", "expires": 1790000000000 }
}
```

`api_key` entries are returned as well, and a route whose pi-ai provider declares an api-key auth method resolves them; `openai-codex` declares only OAuth, so an `api_key` entry for it is ignored.

## Verify

The boot log carries one line per launch:

```
llm-pi-auth: serving openai-codex (<n> models), anthropic (<m> models) from /home/user/.config/pi/auth.json
```

A configured provider with no entry in the file gets a second line naming it.
