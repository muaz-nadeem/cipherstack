import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type AffineConfig = { a: number; b: number }

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

function modInverse(a: number, m: number): number | null {
  const x = ((a % m) + m) % m
  for (let i = 1; i < m; i++) {
    if ((x * i) % m === 1) return i
  }
  return null
}

function parseIntConfig(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseInt(v, 10)
    if (Number.isInteger(n)) return n
  }
  return null
}

function transform(input: string, a: number, b: number, decrypt: boolean): string {
  const aa = ((a % 26) + 26) % 26
  const bb = ((b % 26) + 26) % 26
  const inv = modInverse(aa, 26)
  if (inv === null) throw new Error('Invalid multiplicative key')

  let out = ''
  for (const c of input) {
    if (c >= 'A' && c <= 'Z') {
      const p = c.charCodeAt(0) - 65
      const x = decrypt ? (inv * (p - bb + 26)) % 26 : (aa * p + bb) % 26
      out += String.fromCharCode(65 + x)
    } else if (c >= 'a' && c <= 'z') {
      const p = c.charCodeAt(0) - 97
      const x = decrypt ? (inv * (p - bb + 26)) % 26 : (aa * p + bb) % 26
      out += String.fromCharCode(97 + x)
    } else {
      out += c
    }
  }
  return out
}

export const affineCipher: CipherDefinition = {
  id: 'affine',
  label: 'Affine',
  countsAsConfigurable: true,
  defaultConfig: { a: 5, b: 8 } satisfies AffineConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const a = parseIntConfig(config.a)
    const b = parseIntConfig(config.b)
    if (a === null) return [{ field: 'a', message: 'Affine parameter a must be an integer.' }]
    if (b === null) return [{ field: 'b', message: 'Affine parameter b must be an integer.' }]
    if (gcd(a, 26) !== 1) {
      return [{ field: 'a', message: 'Affine parameter a must be coprime with 26 (e.g. 1,3,5,7,9,11...).' }]
    }
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    const a = parseIntConfig(config.a)
    const b = parseIntConfig(config.b)
    if (a === null || b === null) throw new Error('Invalid affine parameters')
    return transform(input, a, b, false)
  },
  decrypt(input: string, config: CipherConfig): string {
    const a = parseIntConfig(config.a)
    const b = parseIntConfig(config.b)
    if (a === null || b === null) throw new Error('Invalid affine parameters')
    return transform(input, a, b, true)
  },
}
