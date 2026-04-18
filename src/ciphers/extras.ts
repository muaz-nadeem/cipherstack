import type { CipherDefinition, ConfigIssue } from './types'
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '../lib/bytes'

/** Config-free extra: does not count toward minimum of 3 configurable ciphers */
export const reverseCipher: CipherDefinition = {
  id: 'reverse',
  label: 'Reverse string',
  countsAsConfigurable: false,
  defaultConfig: {},
  validateConfig(): ConfigIssue[] {
    return []
  },
  encrypt(input: string): string {
    return [...input].reverse().join('')
  },
  decrypt(input: string): string {
    return [...input].reverse().join('')
  },
}

/** UTF-8 text ↔ Base64; extra */
export const utf8Base64Cipher: CipherDefinition = {
  id: 'utf8_b64',
  label: 'Base64 (UTF-8)',
  countsAsConfigurable: false,
  defaultConfig: {},
  validateConfig(): ConfigIssue[] {
    return []
  },
  encrypt(input: string): string {
    return bytesToBase64(utf8ToBytes(input))
  },
  decrypt(input: string): string {
    const bytes = base64ToBytes(input.trim())
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  },
}
