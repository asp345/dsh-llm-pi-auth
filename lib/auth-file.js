import { access, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_LOCK_TIMEOUT_MS = 5000
const LOCK_RETRY_MS = 20
const LOCK_STALE_MS = 30000

export function resolveAuthPath(configured) {
  const raw = configured ?? (process.env.PI_CODING_AGENT_DIR === undefined
    ? join(homedir(), '.pi', 'agent', 'auth.json')
    : join(process.env.PI_CODING_AGENT_DIR, 'auth.json'))
  return expandHome(raw)
}

export function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

async function readDocument(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
  if (raw.trim().length === 0) return {}
  const parsed = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`llm-pi-auth: ${path} does not hold a JSON object of provider credentials`)
  }
  return parsed
}

async function writeDocument(path, document) {
  const temporary = `${path}.dsh-${process.pid}-${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

async function acquireLock(path, timeoutMs) {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      return async () => {
        await handle.close()
        await unlink(lockPath).catch(() => {})
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(lockPath).catch(() => undefined)
      if (info !== undefined && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => {})
        continue
      }
      if (Date.now() >= deadline) throw new Error(`llm-pi-auth: timed out waiting for ${lockPath}`)
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

export function createAuthFileStore({ path, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS }) {
  return {
    async read(providerId) {
      return (await readDocument(path))[providerId]
    },
    async list() {
      const document = await readDocument(path)
      return Object.entries(document).map(([providerId, credential]) => ({
        providerId,
        type: credential?.type === 'oauth' ? 'oauth' : 'api_key',
      }))
    },
    async modify(providerId, mutate) {
      const release = await acquireLock(path, lockTimeoutMs)
      try {
        const document = await readDocument(path)
        const current = document[providerId]
        const next = await mutate(current)
        if (next !== undefined) {
          document[providerId] = next
          await writeDocument(path, document)
        }
        return next ?? current
      } finally {
        await release()
      }
    },
    async delete(providerId) {
      const release = await acquireLock(path, lockTimeoutMs)
      try {
        const document = await readDocument(path)
        if (document[providerId] === undefined) return
        delete document[providerId]
        await writeDocument(path, document)
      } finally {
        await release()
      }
    },
  }
}

export function processAuthContext() {
  return {
    async env(name) {
      return process.env[name]
    },
    async fileExists(path) {
      try {
        await access(expandHome(path))
        return true
      } catch {
        return false
      }
    },
  }
}
