import { affineCipher } from './affine'
import { describe, expect, it } from 'vitest'
import { caesarCipher } from './caesar'
import { columnarCipher } from './columnar'
import { reverseCipher, utf8Base64Cipher } from './extras'
import { railFenceCipher } from './railFence'
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

describe('Affine round-trip', () => {
  it.each(samples)('sample %j', (text) => {
    const cfg = { a: 5, b: 8 }
    expect(affineCipher.decrypt(affineCipher.encrypt(text, cfg), cfg)).toBe(text)
  })
})

describe('Rail Fence round-trip', () => {
  it.each(samples)('sample %j', (text) => {
    const cfg = { rails: 4, startDown: true }
    expect(railFenceCipher.decrypt(railFenceCipher.encrypt(text, cfg), cfg)).toBe(text)
  })

  it('works with bottom-up start direction', () => {
    const cfg = { rails: 3, startDown: false }
    const t = 'WEAREDISCOVEREDFLEEATONCE'
    expect(railFenceCipher.decrypt(railFenceCipher.encrypt(t, cfg), cfg)).toBe(t)
  })
})

describe('Columnar round-trip', () => {
  it('round-trips when plaintext is already block-aligned', () => {
    const cfg = { keyword: 'matrix', padChar: 'X' }
    const t = 'attackatdawn'
    expect(columnarCipher.decrypt(columnarCipher.encrypt(t, cfg), cfg)).toBe(t)
  })

  it('pads on encrypt and preserves padded plaintext on decrypt', () => {
    const cfg = { keyword: 'agent', padChar: 'Z' }
    const t = 'hello'
    const enc = columnarCipher.encrypt(t, cfg)
    const dec = columnarCipher.decrypt(enc, cfg)
    expect(dec.startsWith(t)).toBe(true)
    expect(dec.length % cfg.keyword.length).toBe(0)
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
