import { base64ToBytes, bytesToBase64, utf8ToBytes, xorRepeating, bytesToUtf8 } from '../lib/bytes'
import type { CipherConfig, CipherDefinition, ConfigIssue } from './types'

export type XorConfig = { key: string }

export const xorBase64Cipher: CipherDefinition = {
  id: 'xor_b64',
  label: 'XOR (UTF-8 → Base64)',
  countsAsConfigurable: true,
  defaultConfig: { key: 'key' } satisfies XorConfig,
  validateConfig(config: CipherConfig): ConfigIssue[] {
    const key = typeof config.key === 'string' ? config.key : ''
    if (key.length === 0) return [{ field: 'key', message: 'Key must be non-empty.' }]
    return []
  },
  encrypt(input: string, config: CipherConfig): string {
    const key = typeof config.key === 'string' ? config.key : ''
    if (key.length === 0) throw new Error('Invalid key')
    const data = utf8ToBytes(input)
    const kb = utf8ToBytes(key)
    const x = xorRepeating(data, kb)
    return bytesToBase64(x)
  },
  decrypt(input: string, config: CipherConfig): string {
    const key = typeof config.key === 'string' ? config.key : ''
    if (key.length === 0) throw new Error('Invalid key')
    const data = base64ToBytes(input.trim())
    const kb = utf8ToBytes(key)
    const x = xorRepeating(data, kb)
    return bytesToUtf8(x)
  },
}
