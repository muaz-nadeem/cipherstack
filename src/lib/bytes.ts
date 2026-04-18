/** UTF-8 byte helpers for XOR pipeline step. */

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function xorRepeating(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) throw new Error('XOR key must be non-empty')
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i]! ^ key[i % key.length]!
  }
  return out
}
