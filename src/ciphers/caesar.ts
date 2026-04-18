import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type CaesarConfig = { shift: number }

function isLetterUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z'
}

function isLetterLower(c: string): boolean {
  return c >= 'a' && c <= 'z'
}

function shiftChar(c: string, delta: number): string {
  if (isLetterUpper(c)) {
    const base = 'A'.charCodeAt(0)
    const x = (c.charCodeAt(0)! - base + delta) % 26
    return String.fromCharCode(base + (x < 0 ? x + 26 : x))
  }
  if (isLetterLower(c)) {
    const base = 'a'.charCodeAt(0)
    const x = (c.charCodeAt(0)! - base + delta) % 26
    return String.fromCharCode(base + (x < 0 ? x + 26 : x))
  }
  return c
}

export function caesarEncrypt(input: string, shift: number): string {
  let out = ''
  for (const ch of input) {
    out += shiftChar(ch, shift)
  }
  return out
}

export function caesarDecrypt(input: string, shift: number): string {
  return caesarEncrypt(input, -shift)
}

function parseShift(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export const caesarCipher: CipherDefinition = {
  id: 'caesar',
  label: 'Caesar',
  countsAsConfigurable: true,
  defaultConfig: { shift: 3 } satisfies CaesarConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const s = parseShift(config.shift)
    if (s === null) return [{ field: 'shift', message: 'Shift must be an integer.' }]
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    const s = parseShift(config.shift)
    if (s === null) throw new Error('Invalid shift')
    return caesarEncrypt(input, s)
  },
  decrypt(input: string, config: CipherConfig): string {
    const s = parseShift(config.shift)
    if (s === null) throw new Error('Invalid shift')
    return caesarDecrypt(input, s)
  },
}
