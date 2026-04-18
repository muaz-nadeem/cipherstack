import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type RailFenceConfig = { rails: number; startDown: boolean }

function parseRails(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseInt(v, 10)
    if (Number.isInteger(n)) return n
  }
  return null
}

function parseStartDown(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return true
}

function railPattern(length: number, rails: number, startDown: boolean): number[] {
  const out: number[] = new Array(length)
  if (rails <= 1) return out.fill(0)

  let rail = 0
  let dir = startDown ? 1 : -1
  if (!startDown) rail = rails - 1

  for (let i = 0; i < length; i++) {
    out[i] = rail
    if (rail === 0) dir = 1
    else if (rail === rails - 1) dir = -1
    rail += dir
  }
  return out
}

export function railFenceEncrypt(input: string, rails: number, startDown: boolean): string {
  if (rails <= 1 || input.length <= 1) return input
  const pattern = railPattern(input.length, rails, startDown)
  const buckets: string[] = Array.from({ length: rails }, () => '')
  for (let i = 0; i < input.length; i++) {
    buckets[pattern[i]!] += input[i]!
  }
  return buckets.join('')
}

export function railFenceDecrypt(input: string, rails: number, startDown: boolean): string {
  if (rails <= 1 || input.length <= 1) return input
  const pattern = railPattern(input.length, rails, startDown)

  const counts = new Array(rails).fill(0)
  for (const r of pattern) counts[r]++

  const railsChars: string[][] = []
  let cursor = 0
  for (let r = 0; r < rails; r++) {
    const count = counts[r]!
    railsChars.push(input.slice(cursor, cursor + count).split(''))
    cursor += count
  }

  let out = ''
  for (const r of pattern) {
    const arr = railsChars[r]!
    out += arr.shift() ?? ''
  }
  return out
}

export const railFenceCipher: CipherDefinition = {
  id: 'rail_fence',
  label: 'Rail Fence',
  countsAsConfigurable: true,
  defaultConfig: { rails: 3, startDown: true } satisfies RailFenceConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const rails = parseRails(config.rails)
    if (rails === null) return [{ field: 'rails', message: 'Rails must be an integer.' }]
    if (rails < 2 || rails > 12) {
      return [{ field: 'rails', message: 'Rails must be between 2 and 12.' }]
    }
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    const rails = parseRails(config.rails)
    if (rails === null) throw new Error('Invalid rails value')
    const startDown = parseStartDown(config.startDown)
    return railFenceEncrypt(input, rails, startDown)
  },
  decrypt(input: string, config: CipherConfig): string {
    const rails = parseRails(config.rails)
    if (rails === null) throw new Error('Invalid rails value')
    const startDown = parseStartDown(config.startDown)
    return railFenceDecrypt(input, rails, startDown)
  },
}
