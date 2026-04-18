import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type ColumnarConfig = { keyword: string; padChar: string }

function lettersOnly(keyword: string): string {
  return keyword.replace(/[^A-Za-z]/g, '').toUpperCase()
}

function parseKeyword(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parsePadChar(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) return 'X'
  return v[0]!
}

function orderFromKeyword(keyword: string): number[] {
  const chars = keyword.split('').map((ch, idx) => ({ ch, idx }))
  chars.sort((a, b) => {
    const c = a.ch.localeCompare(b.ch)
    if (c !== 0) return c
    return a.idx - b.idx
  })
  return chars.map((x) => x.idx)
}

export function columnarEncrypt(input: string, keywordRaw: string, padCharRaw: string): string {
  const keyword = lettersOnly(keywordRaw)
  if (keyword.length < 2) throw new Error('Keyword must contain at least 2 letters')

  const cols = keyword.length
  const padChar = parsePadChar(padCharRaw)
  const rows = Math.ceil(input.length / cols)
  const total = rows * cols
  const padded = input + padChar.repeat(Math.max(0, total - input.length))

  const order = orderFromKeyword(keyword)
  let out = ''
  for (const col of order) {
    for (let row = 0; row < rows; row++) {
      out += padded[row * cols + col]!
    }
  }
  return out
}

export function columnarDecrypt(input: string, keywordRaw: string): string {
  const keyword = lettersOnly(keywordRaw)
  if (keyword.length < 2) throw new Error('Keyword must contain at least 2 letters')
  const cols = keyword.length
  if (input.length % cols !== 0) {
    throw new Error('Ciphertext length must be divisible by keyword length')
  }
  const rows = input.length / cols

  const order = orderFromKeyword(keyword)
  const matrix: string[][] = Array.from({ length: rows }, () => Array(cols).fill(''))

  let cursor = 0
  for (const col of order) {
    for (let row = 0; row < rows; row++) {
      matrix[row]![col] = input[cursor++]!
    }
  }

  return matrix.map((row) => row.join('')).join('')
}

export const columnarCipher: CipherDefinition = {
  id: 'columnar',
  label: 'Columnar',
  countsAsConfigurable: true,
  defaultConfig: { keyword: 'matrix', padChar: 'X' } satisfies ColumnarConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const keyword = lettersOnly(parseKeyword(config.keyword))
    if (keyword.length < 2) {
      return [{ field: 'keyword', message: 'Columnar keyword needs at least 2 letters.' }]
    }
    const pad = parsePadChar(config.padChar)
    if (pad.length !== 1) {
      return [{ field: 'padChar', message: 'Pad character must be exactly one character.' }]
    }
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    return columnarEncrypt(input, parseKeyword(config.keyword), parsePadChar(config.padChar))
  },
  decrypt(input: string, config: CipherConfig): string {
    return columnarDecrypt(input, parseKeyword(config.keyword))
  },
}
