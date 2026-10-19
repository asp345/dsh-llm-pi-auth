# dsh-llm-pi-auth

dsh plugin that serves pi-ai provider routes with the credentials the pi coding agent keeps in its `auth.json`, and refreshes them into that same file.

## Why

The pi coding agent keeps OAuth credentials in `auth.json`, one per provider; dsh reads credentials from its own store. Copying a credential between the two forks the refresh chain, because providers rotate the refresh token on use, so whichever copy refreshes first invalidates the other. This plugin gives dsh a `CredentialStore` on the pi file, so a refresh writes back to the file pi reads.

## Install

```bash
dsh plugin --profile web add github:asp345/dsh-llm-pi-auth
```

`dsh plugin --profile web update dsh-llm-pi-auth` picks up later commits.

One provider id can be registered by one adapter only. If the profile's `llm-pi-ai` row lists an id this plugin serves, drop that entry from its `providers`; otherwise the second adapter fails to load with `DUPLICATE_ADAPTER`.

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
