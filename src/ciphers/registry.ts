import { affineCipher } from './affine'
import { caesarCipher } from './caesar'
import { columnarCipher } from './columnar'
import { reverseCipher, utf8Base64Cipher } from './extras'
import { railFenceCipher } from './railFence'
import type { CipherDefinition } from './types'
import { vigenereCipher } from './vigenere'
import { xorBase64Cipher } from './xorBase64'

const list: CipherDefinition[] = [
  caesarCipher,
  vigenereCipher,
  xorBase64Cipher,
  affineCipher,
  railFenceCipher,
  columnarCipher,
  reverseCipher,
  utf8Base64Cipher,
]

export const cipherRegistry: Record<string, CipherDefinition> = Object.fromEntries(
  list.map((c) => [c.id, c]),
)

export const cipherListOrdered: CipherDefinition[] = list

export function getCipher(id: string): CipherDefinition | undefined {
  return cipherRegistry[id]
}
