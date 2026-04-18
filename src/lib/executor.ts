import { getCipher } from '../ciphers/registry'
import type { CipherConfig } from '../ciphers/types'

export const MIN_PIPELINE_NODES = 3

export type PipelineNode = {
  id: string
  cipherId: string
  config: CipherConfig
}

export type TraceStep = {
  nodeId: string
  cipherId: string
  cipherLabel: string
  input: string
  output: string
}

export type RunResult =
  | { ok: true; steps: TraceStep[]; finalOutput: string }
  | { ok: false; error: string }

function validatePipeline(nodes: PipelineNode[]): string | null {
  if (nodes.length < MIN_PIPELINE_NODES) {
    return `Add at least ${MIN_PIPELINE_NODES} nodes before running the pipeline.`
  }
  for (const n of nodes) {
    const def = getCipher(n.cipherId)
    if (!def) return `Unknown cipher: ${n.cipherId}`
    const issues = def.validateConfig(n.config)
    if (issues.length > 0) return issues.map((i) => i.message).join(' ')
  }
  return null
}

export function runForward(nodes: PipelineNode[], plaintext: string): RunResult {
  const err = validatePipeline(nodes)
  if (err) return { ok: false, error: err }

  const steps: TraceStep[] = []
  let current = plaintext
  for (const n of nodes) {
    const def = getCipher(n.cipherId)!
    const input = current
    let output: string
    try {
      output = def.encrypt(input, n.config)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `Encrypt failed at “${def.label}”: ${msg}` }
    }
    steps.push({
      nodeId: n.id,
      cipherId: n.cipherId,
      cipherLabel: def.label,
      input,
      output,
    })
    current = output
  }
  return { ok: true, steps, finalOutput: current }
}

/** Decrypt: start from last node, apply each node's decrypt in reverse pipeline order */
export function runBackward(nodes: PipelineNode[], ciphertext: string): RunResult {
  const err = validatePipeline(nodes)
  if (err) return { ok: false, error: err }

  const steps: TraceStep[] = []
  let current = ciphertext
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!
    const def = getCipher(n.cipherId)!
    const input = current
    let output: string
    try {
      output = def.decrypt(input, n.config)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `Decrypt failed at “${def.label}”: ${msg}` }
    }
    steps.push({
      nodeId: n.id,
      cipherId: n.cipherId,
      cipherLabel: `${def.label} (decrypt)`,
      input,
      output,
    })
    current = output
  }
  return { ok: true, steps, finalOutput: current }
}
