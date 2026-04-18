import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type VigenereConfig = { keyword: string }

function lettersOnly(keyword: string): string {
  return keyword.replace(/[^A-Za-z]/g, '')
}

export function vigenereEncrypt(input: string, keyword: string): string {
  const key = lettersOnly(keyword)
  if (key.length === 0) throw new Error('Keyword must contain at least one letter')
  let ki = 0
  let out = ''
  for (const c of input) {
    if (c >= 'A' && c <= 'Z') {
      const k = key[ki % key.length]!.toUpperCase().charCodeAt(0) - 65
      const p = c.charCodeAt(0)! - 65
      out += String.fromCharCode(65 + ((p + k) % 26))
      ki++
    } else if (c >= 'a' && c <= 'z') {
      const k = key[ki % key.length]!.toLowerCase().charCodeAt(0) - 97
      const p = c.charCodeAt(0)! - 97
      out += String.fromCharCode(97 + ((p + k) % 26))
      ki++
    } else {
      out += c
    }
  }
  return out
}

export function vigenereDecrypt(input: string, keyword: string): string {
  const key = lettersOnly(keyword)
  if (key.length === 0) throw new Error('Keyword must contain at least one letter')
  let ki = 0
  let out = ''
  for (const c of input) {
    if (c >= 'A' && c <= 'Z') {
      const k = key[ki % key.length]!.toUpperCase().charCodeAt(0) - 65
      const p = c.charCodeAt(0)! - 65
      out += String.fromCharCode(65 + ((p - k + 26) % 26))
      ki++
    } else if (c >= 'a' && c <= 'z') {
      const k = key[ki % key.length]!.toLowerCase().charCodeAt(0) - 97
      const p = c.charCodeAt(0)! - 97
      out += String.fromCharCode(97 + ((p - k + 26) % 26))
      ki++
    } else {
      out += c
    }
  }
  return out
}

export const vigenereCipher: CipherDefinition = {
  id: 'vigenere',
  label: 'Vigenère',
  countsAsConfigurable: true,
  defaultConfig: { keyword: 'lemon' } satisfies VigenereConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const kw = typeof config.keyword === 'string' ? config.keyword : ''
    if (lettersOnly(kw).length === 0) {
      return [{ field: 'keyword', message: 'Keyword needs at least one A–Z letter.' }]
    }
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    const kw = typeof config.keyword === 'string' ? config.keyword : ''
    return vigenereEncrypt(input, kw)
  },
  decrypt(input: string, config: CipherConfig): string {
    const kw = typeof config.keyword === 'string' ? config.keyword : ''
    return vigenereDecrypt(input, kw)
  },
}
