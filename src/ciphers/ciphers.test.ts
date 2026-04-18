import { describe, expect, it } from 'vitest'
import { caesarCipher } from './caesar'
import { reverseCipher, utf8Base64Cipher } from './extras'
import { vigenereCipher } from './vigenere'
import { xorBase64Cipher } from './xorBase64'
import { runBackward, runForward, type PipelineNode } from '../lib/executor'

function id(): string {
  return crypto.randomUUID()
}

const samples = ['', 'a', 'Hello, World! 123', 'café', 'Καλημέρα', 'AaZz\n\t']

describe('Caesar round-trip', () => {
  it.each(samples)('sample %j', (text) => {
    const cfg = { shift: 11 }
    expect(caesarCipher.decrypt(caesarCipher.encrypt(text, cfg), cfg)).toBe(text)
  })
})

describe('Vigenère round-trip', () => {
  it.each(samples)('sample %j', (text) => {
    const cfg = { keyword: 'Secret-Key_99' }
    expect(vigenereCipher.decrypt(vigenereCipher.encrypt(text, cfg), cfg)).toBe(text)
  })
})

describe('XOR Base64 round-trip', () => {
  it.each(samples.filter((s) => s !== ''))('sample %j', (text) => {
    const cfg = { key: 'abc\x00' }
    expect(xorBase64Cipher.decrypt(xorBase64Cipher.encrypt(text, cfg), cfg)).toBe(text)
  })
})

describe('extras', () => {
  it('reverse', () => {
    const t = 'abcDEF'
    expect(reverseCipher.decrypt(reverseCipher.encrypt(t, {}), {})).toBe(t)
  })
  it('utf8 base64', () => {
    const t = 'emoji 🎉'
    expect(utf8Base64Cipher.decrypt(utf8Base64Cipher.encrypt(t, {}), {})).toBe(t)
  })
})

describe('pipeline integration', () => {
  it('3-node forward/backward restores plaintext', () => {
    const nodes: PipelineNode[] = [
      { id: id(), cipherId: 'caesar', config: { shift: 3 } },
      { id: id(), cipherId: 'xor_b64', config: { key: 'k' } },
      { id: id(), cipherId: 'vigenere', config: { keyword: 'lime' } },
    ]
    const plain = 'Attack at dawn!'
    const enc = runForward(nodes, plain)
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = runBackward(nodes, enc.finalOutput)
    expect(dec.ok).toBe(true)
    if (!dec.ok) return
    expect(dec.finalOutput).toBe(plain)
  })
})
