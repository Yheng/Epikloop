// Harbor's start-of-session hook. It records where this plugin is installed, in
// ~/.epikloop/harbor.json, since the core's /epikloop:harbor has no other way to find another
// plugin's files. Then, while the harbor flag in ~/.epikloop/config.json is on, it starts Harbor
// with `harbor.mjs start`, which returns at once when Harbor already runs. It reads the flag itself,
// and a config that doesn't parse counts as off at once, so no session waits out the 5 seconds
// Harbor gives such a file.
//
// Like every Epikloop hook it prints nothing but its JSON answer and exits 0: nothing at all when
// all went well, or a message for the human when Harbor couldn't start.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// The message for the human, or null when there is none.
function session() {
  const dir = path.join(os.homedir(), '.epikloop')
  const pointer = path.join(dir, 'harbor.json')
  if (readJson(pointer)?.root !== ROOT) {
    fs.mkdirSync(dir, { recursive: true })
    const part = `${pointer}.${process.pid}.tmp`
    fs.writeFileSync(part, `${JSON.stringify({ format: 1, root: ROOT })}\n`)
    fs.renameSync(part, pointer)
  }
  if (readJson(path.join(dir, 'config.json'))?.harbor !== true) return null
  const run = spawnSync(process.execPath, [path.join(ROOT, 'harbor.mjs'), 'start'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
  if (run.status === 0) return null
  const said = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split(/\r?\n/).at(-1)
  return `Harbor didn't start: ${said || run.error?.message || `harbor.mjs start ended with ${run.signal ?? run.status}`}`
}

let message
try {
  message = session()
} catch (error) {
  message = `Harbor's session hook failed: ${error.message}`
}
if (message !== null) process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`)
process.exitCode = 0
