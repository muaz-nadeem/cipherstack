export type CipherConfig = Record<string, unknown>

export type ConfigIssue = { field?: string; message: string }

export interface CipherDefinition {
  id: string
  label: string
  /** Counts toward hackathon minimum of 3 configurable types when true */
  countsAsConfigurable: boolean
  defaultConfig: CipherConfig
  validateConfig(config: CipherConfig): ConfigIssue[]
  encrypt(input: string, config: CipherConfig): string
  decrypt(input: string, config: CipherConfig): string
}
