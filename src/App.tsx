import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { base64ToBytes, utf8ToBytes } from './lib/bytes'
import { cipherListOrdered, getCipher } from './ciphers/registry'
import type { CipherConfig } from './ciphers/types'
import {
  MIN_PIPELINE_NODES,
  runBackward,
  runForward,
  type PipelineNode,
  type TraceStep,
} from './lib/executor'

const NODE_W = 300
const NODE_H_FALLBACK = 220
const CANVAS_PAD = 48
const CANVAS_MIN_H = 380
const MAX_IMPORT_NODES = 40
const SPAWN_X0 = 40
const SPAWN_Y0 = 72
const NODE_H_GAP = 36
const NODE_V_GAP = 48

/** Short node names for the library; falls back to cipher `label`. */
const NODE_LIBRARY_DISPLAY: Partial<Record<string, string>> = {
  xor_b64: 'XOR',
  utf8_b64: 'Base64',
  reverse: 'Reverse',
  rail_fence: 'Rail Fence',
  columnar: 'Columnar',
  affine: 'Affine',
}

const SIDEBAR_ROWS: { display: string; cipherId: string }[] = cipherListOrdered.map((c) => ({
  display: NODE_LIBRARY_DISPLAY[c.id] ?? c.label,
  cipherId: c.id,
}))

type PipelineCanvasNode = PipelineNode & { x: number; y: number }

function newId(): string {
  return crypto.randomUUID()
}

function cloneConfig(defId: string): CipherConfig {
  const def = getCipher(defId)
  if (!def) return {}
  return structuredClone(def.defaultConfig)
}

function toPipeline(nodes: PipelineCanvasNode[]): PipelineNode[] {
  return nodes.map(({ id, cipherId, config }) => ({ id, cipherId, config }))
}

function bottomOfNodes(nodes: PipelineCanvasNode[], heights: Record<string, number>): number {
  let maxB = 0
  for (const n of nodes) {
    const h = heights[n.id] ?? NODE_H_FALLBACK
    maxB = Math.max(maxB, n.y + h)
  }
  return maxB
}

function spawnPosition(
  prev: PipelineCanvasNode[],
  canvasInnerWidth: number,
  heights: Record<string, number>,
): { x: number; y: number } {
  if (prev.length === 0) return { x: SPAWN_X0, y: SPAWN_Y0 }
  const last = prev[prev.length - 1]!
  const inner = Math.max(canvasInnerWidth, NODE_W + CANVAS_PAD * 2)
  const rightLimit = inner - CANVAS_PAD
  const proposedX = last.x + NODE_W + NODE_H_GAP
  if (proposedX + NODE_W <= rightLimit) {
    return { x: proposedX, y: last.y }
  }
  const rowBottom = bottomOfNodes(prev, heights)
  return { x: SPAWN_X0, y: rowBottom + NODE_V_GAP }
}

function swapAdjacentPipelineSlots(copy: PipelineCanvasNode[], left: number, right: number) {
  const a = copy[left]!
  const b = copy[right]!
  const ax = a.x
  const ay = a.y
  const bx = b.x
  const by = b.y
  copy[left] = { ...b, x: ax, y: ay }
  copy[right] = { ...a, x: bx, y: by }
}

/** Single-row layout: forward = encrypt order left→right; reverse = decrypt view (last node left). */
function layoutNodesRow(nodes: PipelineCanvasNode[], order: 'forward' | 'reverse'): PipelineCanvasNode[] {
  const len = nodes.length
  if (len === 0) return nodes
  return nodes.map((node, pipelineIdx) => {
    const col = order === 'forward' ? pipelineIdx : len - 1 - pipelineIdx
    return {
      ...node,
      x: SPAWN_X0 + col * (NODE_W + NODE_H_GAP),
      y: SPAWN_Y0,
    }
  })
}

type Mode = 'encrypt' | 'decrypt'
type CanvasFlow = 'forward' | 'reverse'

type DragState = { id: string; offsetX: number; offsetY: number }

function shiftHexLabel(shift: CipherConfig['shift']): string {
  const n = typeof shift === 'number' ? shift : Number.parseInt(String(shift), 10)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return '—'
  const u = ((n % 256) + 256) % 256
  return `0x${u.toString(16).toUpperCase().padStart(2, '0')}`
}

function bytesToHexSpaced(bytes: Uint8Array, maxBytes = 20): string {
  const n = Math.min(bytes.length, maxBytes)
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(bytes[i]!.toString(16).toUpperCase().padStart(2, '0'))
  }
  let s = parts.join(' ')
  if (bytes.length > maxBytes) s += ' …'
  return s || '—'
}

function xorOutputHex(s: string): string {
  const t = s.trim()
  try {
    return bytesToHexSpaced(base64ToBytes(t))
  } catch {
    return bytesToHexSpaced(utf8ToBytes(t))
  }
}

function randomSessionId(): string {
  const part = () => Math.floor(1000 + Math.random() * 9000)
  return `${part()}-X99-LAB`
}

function toBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no') return false
  }
  return fallback
}

export default function App() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nodeHeightsRef = useRef<Record<string, number>>({})
  const canvasFlowRef = useRef<CanvasFlow>('forward')
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({})
  const [nodes, setNodes] = useState<PipelineCanvasNode[]>([])
  const [canvasFlow, setCanvasFlow] = useState<CanvasFlow>('forward')
  const [mode, setMode] = useState<Mode>('encrypt')
  const [plaintext, setPlaintext] = useState('hello')
  const [ciphertext, setCiphertext] = useState('')
  const [traceByNodeId, setTraceByNodeId] = useState<Record<string, TraceStep>>({})
  const [finalOut, setFinalOut] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [reorderMessage, setReorderMessage] = useState<string | null>(null)
  const [selectedSidebarCipherId, setSelectedSidebarCipherId] = useState(SIDEBAR_ROWS[0]!.cipherId)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [sessionId] = useState(randomSessionId)
  const [copyFlash, setCopyFlash] = useState(false)

  const pipeline = useMemo(() => toPipeline(nodes), [nodes])

  useEffect(() => {
    canvasFlowRef.current = canvasFlow
  }, [canvasFlow])

  const clearOutputs = useCallback(() => {
    setTraceByNodeId({})
    setFinalOut(null)
    setRunError(null)
    setStale(false)
  }, [])

  const markStale = useCallback(() => {
    setStale(true)
    setRunError(null)
  }, [])

  const addCipher = useCallback(
    (cipherId: string) => {
      setSelectedSidebarCipherId(cipherId)
      setNodes((prev) => {
        const innerW =
          canvasRef.current?.clientWidth ??
          (typeof window !== 'undefined' ? window.innerWidth - 280 : 1200)
        const pos = spawnPosition(prev, innerW, nodeHeightsRef.current)
        const next = [...prev, { id: newId(), cipherId, config: cloneConfig(cipherId), ...pos }]
        return layoutNodesRow(next, canvasFlowRef.current)
      })
      clearOutputs()
    },
    [clearOutputs],
  )

  const removeNode = useCallback(
    (id: string) => {
      setNodes((prev) => layoutNodesRow(
        prev.filter((n) => n.id !== id),
        canvasFlowRef.current,
      ))
      clearOutputs()
    },
    [clearOutputs],
  )

  const swapWithNextInPipeline = useCallback(
    (index: number) => {
      setReorderMessage(null)
      if (index >= nodes.length - 1) {
        setReorderMessage('There is no node after this one in the pipeline.')
        return
      }
      setNodes((prev) => {
        const j = index + 1
        if (j >= prev.length) return prev
        const copy = [...prev]
        swapAdjacentPipelineSlots(copy, index, j)
        return layoutNodesRow(copy, canvasFlowRef.current)
      })
      clearOutputs()
    },
    [nodes.length, clearOutputs],
  )

  const swapWithPreviousInPipeline = useCallback(
    (index: number) => {
      setReorderMessage(null)
      if (index <= 0) {
        setReorderMessage('There is no node before this one in the pipeline.')
        return
      }
      setNodes((prev) => {
        const j = index - 1
        if (j < 0) return prev
        const copy = [...prev]
        swapAdjacentPipelineSlots(copy, j, index)
        return layoutNodesRow(copy, canvasFlowRef.current)
      })
      clearOutputs()
    },
    [clearOutputs],
  )

  useEffect(() => {
    if (!reorderMessage) return
    const t = window.setTimeout(() => setReorderMessage(null), 4200)
    return () => window.clearTimeout(t)
  }, [reorderMessage])

  const updateConfig = useCallback(
    (nodeId: string, patch: CipherConfig) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, ...patch } } : n)),
      )
      markStale()
    },
    [markStale],
  )

  useEffect(() => {
    nodeHeightsRef.current = nodeHeights
  }, [nodeHeights])

  useEffect(() => {
    const root = canvasRef.current
    if (!root) {
      setNodeHeights({})
      return
    }
    if (nodes.length === 0) {
      setNodeHeights({})
      return
    }

    const ids = new Set(nodes.map((n) => n.id))
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-node-box]'))

    const applyHeights = (measure: (el: Element) => number) => {
      const merged: Record<string, number> = {}
      for (const el of elements) {
        const id = el.getAttribute('data-node-box')
        if (!id || !ids.has(id)) continue
        const h = measure(el)
        if (h > 0) merged[id] = h
      }
      setNodeHeights(merged)
    }

    const ro = new ResizeObserver((entries) => {
      setNodeHeights((prev) => {
        const merged = { ...prev }
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-node-box')
          if (!id || !ids.has(id)) continue
          merged[id] = entry.contentRect.height
        }
        return merged
      })
    })

    for (const el of elements) {
      ro.observe(el)
    }
    requestAnimationFrame(() => {
      applyHeights((el) => el.getBoundingClientRect().height)
    })

    return () => {
      ro.disconnect()
    }
  }, [nodes, traceByNodeId])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const el = canvasRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      let nx = e.clientX - r.left - drag.offsetX
      let ny = e.clientY - r.top - drag.offsetY
      const h = nodeHeightsRef.current[drag.id] ?? NODE_H_FALLBACK
      nx = Math.max(0, Math.min(nx, r.width - NODE_W))
      ny = Math.max(0, Math.min(ny, r.height - h))
      setNodes((prev) => prev.map((n) => (n.id === drag.id ? { ...n, x: nx, y: ny } : n)))
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag])

  const beginDrag = useCallback((e: React.PointerEvent, node: PipelineCanvasNode) => {
    if (e.button !== 0) return
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    e.preventDefault()
    setDrag({
      id: node.id,
      offsetX: e.clientX - r.left - node.x,
      offsetY: e.clientY - r.top - node.y,
    })
  }, [])

  const applyEncryptRun = useCallback(() => {
    const t0 = performance.now()
    setStale(false)
    setRunError(null)
    setMode('encrypt')
    const res = runForward(pipeline, plaintext)
    setLastLatencyMs(Math.round((performance.now() - t0) * 100) / 100)
    if (!res.ok) {
      setTraceByNodeId({})
      setFinalOut(null)
      setRunError(res.error)
      return
    }
    const map: Record<string, TraceStep> = {}
    for (const s of res.steps) {
      map[s.nodeId] = s
    }
    setTraceByNodeId(map)
    setFinalOut(res.finalOutput)
    setCiphertext(res.finalOutput)
    setCanvasFlow('forward')
    setNodes((prev) => layoutNodesRow(prev, 'forward'))
  }, [pipeline, plaintext])

  const applyDecryptRun = useCallback(
    (cipherInput?: string) => {
      const t0 = performance.now()
      setStale(false)
      setRunError(null)
      setMode('decrypt')
      const input = (cipherInput ?? ciphertext).trim()
      const res = runBackward(pipeline, input)
      setLastLatencyMs(Math.round((performance.now() - t0) * 100) / 100)
      if (!res.ok) {
        setTraceByNodeId({})
        setFinalOut(null)
        setRunError(res.error)
        return
      }
      const map: Record<string, TraceStep> = {}
      for (const s of res.steps) {
        map[s.nodeId] = s
      }
      setTraceByNodeId(map)
      setFinalOut(res.finalOutput)
      setPlaintext(res.finalOutput)
      setCiphertext(input)
      setCanvasFlow('reverse')
      setNodes((prev) => layoutNodesRow(prev, 'reverse'))
    },
    [pipeline, ciphertext],
  )

  const validationHint = useMemo(() => {
    if (nodes.length === 0) return 'Select an algorithm from the library to place a node.'
    if (nodes.length < MIN_PIPELINE_NODES) {
      return `Add at least ${MIN_PIPELINE_NODES} nodes (currently ${nodes.length}).`
    }
    for (const n of nodes) {
      const def = getCipher(n.cipherId)
      if (!def) return 'Unknown node type.'
      const issues = def.validateConfig(n.config)
      if (issues.length) return issues[0]!.message
    }
    return null
  }, [nodes])

  const edgeSegments = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; key: string }[] = []
    if (nodes.length < 2) return out
    if (canvasFlow === 'forward') {
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i]!
        const b = nodes[i + 1]!
        const ha = nodeHeights[a.id] ?? NODE_H_FALLBACK
        const hb = nodeHeights[b.id] ?? NODE_H_FALLBACK
        out.push({
          key: `${a.id}-${b.id}`,
          x1: a.x + NODE_W,
          y1: a.y + ha / 2,
          x2: b.x,
          y2: b.y + hb / 2,
        })
      }
    } else {
      for (let k = 0; k < nodes.length - 1; k++) {
        const a = nodes[nodes.length - 1 - k]!
        const b = nodes[nodes.length - 2 - k]!
        const ha = nodeHeights[a.id] ?? NODE_H_FALLBACK
        const hb = nodeHeights[b.id] ?? NODE_H_FALLBACK
        out.push({
          key: `${a.id}-${b.id}`,
          x1: a.x + NODE_W,
          y1: a.y + ha / 2,
          x2: b.x,
          y2: b.y + hb / 2,
        })
      }
    }
    return out
  }, [nodes, nodeHeights, canvasFlow])

  const canvasExtent = useMemo(() => {
    if (nodes.length === 0) {
      return { right: NODE_W * 3 + CANVAS_PAD * 2, bottom: CANVAS_MIN_H }
    }
    let maxBottom = CANVAS_MIN_H
    let maxRight = NODE_W + CANVAS_PAD
    for (const n of nodes) {
      const h = nodeHeights[n.id] ?? NODE_H_FALLBACK
      maxBottom = Math.max(maxBottom, n.y + h + CANVAS_PAD)
      maxRight = Math.max(maxRight, n.x + NODE_W + CANVAS_PAD)
    }
    return { right: maxRight, bottom: maxBottom }
  }, [nodes, nodeHeights])

  const sequenceText = useMemo(() => {
    if (nodes.length === 0) return 'SEQUENCE: ···'
    const labels = nodes.map((n) => {
      const d = getCipher(n.cipherId)
      return d ? d.label.toUpperCase() : n.cipherId.toUpperCase()
    })
    const ordered = canvasFlow === 'reverse' ? [...labels].reverse() : labels
    return `SEQUENCE: ${ordered.join(' → ')}`
  }, [nodes, canvasFlow])

  /** Left→right on canvas; reverse flow shows decrypt order (last pipeline node first). */
  const visualNodes = useMemo(() => {
    if (nodes.length === 0) return []
    return canvasFlow === 'reverse' ? [...nodes].reverse() : [...nodes]
  }, [nodes, canvasFlow])

  const newPipeline = useCallback(() => {
    setNodes([])
    setPlaintext('hello')
    setCiphertext('')
    setTraceByNodeId({})
    setFinalOut(null)
    setRunError(null)
    setStale(false)
    setMode('encrypt')
    setCanvasFlow('forward')
  }, [])

  const exportPipeline = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: pipeline.map(({ cipherId, config }) => ({ cipherId, config: structuredClone(config) })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sanctum-pipeline.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [pipeline])

  const importPipelineFromJson = useCallback(
    (text: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setRunError('Import failed: invalid JSON.')
        return
      }
      const rawNodes = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && 'nodes' in parsed
          ? (parsed as { nodes: unknown }).nodes
          : null

      if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
        setRunError('Import failed: nodes must be a non-empty array.')
        return
      }
      if (rawNodes.length > MAX_IMPORT_NODES) {
        setRunError(`Import failed: max ${MAX_IMPORT_NODES} nodes allowed (got ${rawNodes.length}).`)
        return
      }
      const innerW =
        canvasRef.current?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth - 280 : 1200)
      const next: PipelineCanvasNode[] = []
      for (let i = 0; i < rawNodes.length; i++) {
        const item = rawNodes[i]
        if (!item || typeof item !== 'object' || !('cipherId' in item)) {
          setRunError(`Import failed at node ${i + 1}: each node needs cipherId.`)
          return
        }
        const cipherId = String((item as { cipherId: unknown }).cipherId)
        const def = getCipher(cipherId)
        if (!def) {
          setRunError(`Import failed at node ${i + 1}: unknown cipher “${cipherId}”.`)
          return
        }
        if (
          'config' in item &&
          (item as { config: unknown }).config !== undefined &&
          ((item as { config: unknown }).config === null ||
            Array.isArray((item as { config: unknown }).config))
        ) {
          setRunError(`Import failed at node ${i + 1}: config must be an object.`)
          return
        }
        const importedConfig =
          'config' in item && (item as { config: unknown }).config && typeof (item as { config: unknown }).config === 'object'
            ? structuredClone((item as { config: CipherConfig }).config)
            : {}
        const config = { ...cloneConfig(cipherId), ...importedConfig }
        const issues = def.validateConfig(config)
        if (issues.length > 0) {
          setRunError(`Import failed at node ${i + 1}: ${issues[0]!.message}`)
          return
        }
        const pos = spawnPosition(next, innerW, {})
        next.push({ id: newId(), cipherId, config, ...pos })
      }
      setCanvasFlow('forward')
      setNodes(layoutNodesRow(next, 'forward'))
      setSelectedSidebarCipherId(next[0]!.cipherId)
      clearOutputs()
      setRunError(null)
    },
    [clearOutputs],
  )

  const onImportFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (file.size > 512 * 1024) {
        setRunError('Import failed: file too large (max 512KB).')
        return
      }
      const reader = new FileReader()
      reader.onerror = () => setRunError('Import failed: could not read file.')
      reader.onload = () => {
        const t = typeof reader.result === 'string' ? reader.result : ''
        if (t.trim() === '') {
          setRunError('Import failed: file is empty.')
          return
        }
        importPipelineFromJson(t)
      }
      reader.readAsText(file)
    },
    [importPipelineFromJson],
  )

  const copyResult = useCallback(async () => {
    const text = finalOut ?? ciphertext
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopyFlash(true)
      window.setTimeout(() => setCopyFlash(false), 1200)
    } catch {
      setRunError('Copy failed (clipboard permission).')
    }
  }, [finalOut, ciphertext])

  const nodeAccentClass = (i: number) => {
    const m = i % 3
    if (m === 0) return 'sanctum-node--a'
    if (m === 1) return 'sanctum-node--b'
    return 'sanctum-node--c'
  }

  return (
    <div className={`sanctum${drag ? ' sanctum--dragging' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="sanctum-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={onImportFileChange}
      />

      <header className="sanctum-topnav">
        <div className="sanctum-brand">THE_SANCTUM</div>
        <nav className="sanctum-topnav-center" aria-label="Pipeline">
          <button type="button" className="sanctum-navlink sanctum-navlink--active" onClick={newPipeline}>
            NEW PIPELINE
          </button>
          <button type="button" className="sanctum-navlink" onClick={() => fileInputRef.current?.click()}>
            IMPORT
          </button>
          <button type="button" className="sanctum-navlink" onClick={exportPipeline}>
            EXPORT
          </button>
        </nav>
        <div className="sanctum-topnav-spacer" aria-hidden="true" />
      </header>

      <div className="sanctum-body">
        <aside className="sanctum-sidebar">
          <div className="sanctum-algo-head">
            <div className="sanctum-algo-title">Node Library</div>
            <div className="sanctum-algo-ver">V.2.0.4-STABLE</div>
          </div>
          <ul className="sanctum-algo-list">
            {SIDEBAR_ROWS.map((row) => {
              const active = selectedSidebarCipherId === row.cipherId
              return (
                <li key={row.cipherId}>
                  <button
                    type="button"
                    className={`sanctum-algo-item${active ? ' sanctum-algo-item--active' : ''}`}
                    title={`Add ${getCipher(row.cipherId)?.label ?? row.cipherId} node`}
                    onClick={() => addCipher(row.cipherId)}
                  >
                    <span className="sanctum-algo-icon" aria-hidden>
                      ◆
                    </span>
                    <span className="sanctum-algo-label">{row.display}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <main className="sanctum-main">
          <div className="sanctum-cascade-head">
            <h1 className="sanctum-cascade-title">CASCADE_PROTOCOL</h1>
            <p className="sanctum-cascade-sub">{sequenceText}</p>
          </div>

          {(runError || stale || validationHint || reorderMessage) && (
            <div className="sanctum-alerts" role="region" aria-label="Status">
              {runError && <div className="sanctum-alert sanctum-alert--err">{runError}</div>}
              {stale && !runError && (
                <div className="sanctum-alert sanctum-alert--stale">Config or text changed — run ENCRYPT/DECRYPT again.</div>
              )}
              {validationHint && <div className="sanctum-alert sanctum-alert--info">{validationHint}</div>}
              {reorderMessage && (
                <div className="sanctum-alert sanctum-alert--warn" role="status">
                  {reorderMessage}
                </div>
              )}
            </div>
          )}

          <section className="sanctum-canvas-panel">
            <div
              ref={canvasRef}
              className="sanctum-canvas"
              style={{
                width: `max(100%, ${canvasExtent.right}px)`,
                height: `${canvasExtent.bottom}px`,
              }}
            >
              <svg
                className="sanctum-canvas-edges"
                aria-hidden
                width="100%"
                height="100%"
                preserveAspectRatio="none"
              >
                {edgeSegments.map((seg) => (
                  <line
                    key={seg.key}
                    x1={seg.x1}
                    y1={seg.y1}
                    x2={seg.x2}
                    y2={seg.y2}
                    className="sanctum-edge-line"
                  />
                ))}
              </svg>

              {nodes.length === 0 && (
                <div className="sanctum-canvas-empty">Choose a node from Node Library — nodes appear here.</div>
              )}

              {visualNodes.map((n, vi) => {
                const pipelineIdx = canvasFlow === 'reverse' ? nodes.length - 1 - vi : vi
                const def = getCipher(n.cipherId)
                if (!def) return null
                const step = traceByNodeId[n.id]
                const isDragging = drag?.id === n.id
                const isFinalReadout =
                  canvasFlow === 'forward'
                    ? pipelineIdx === nodes.length - 1
                    : pipelineIdx === 0
                const accent = nodeAccentClass(pipelineIdx)
                const outLabel =
                  def.id === 'xor_b64' ? 'HEX' : isFinalReadout ? 'FINAL' : 'OUT'
                const secondReadout =
                  def.id === 'xor_b64' && step
                    ? xorOutputHex(step.output)
                    : step
                      ? step.output
                      : ''

                return (
                  <article
                    key={n.id}
                    data-node-box={n.id}
                    className={`sanctum-node ${accent}${isDragging ? ' sanctum-node--dragging' : ''}`}
                    style={{ left: n.x, top: n.y, width: NODE_W }}
                  >
                    <div
                      className="sanctum-node-drag"
                      onPointerDown={(e) => beginDrag(e, n)}
                      title="Drag header to reposition"
                    >
                      <span className="sanctum-node-idx">
                        NODE {(pipelineIdx + 1).toString().padStart(2, '0')}
                      </span>
                      <span className="sanctum-node-name">{def.label.toUpperCase()}</span>
                      <button
                        type="button"
                        className="sanctum-node-remove"
                        title="Remove node"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeNode(n.id)
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="sanctum-node-reorder">
                      <button
                        type="button"
                        className="sanctum-mini-btn"
                        onClick={() => swapWithPreviousInPipeline(pipelineIdx)}
                      >
                        ← SWAP
                      </button>
                      <button
                        type="button"
                        className="sanctum-mini-btn"
                        onClick={() => swapWithNextInPipeline(pipelineIdx)}
                      >
                        SWAP →
                      </button>
                    </div>
                    <div className="sanctum-node-body">
                      <div className="sanctum-node-fields">
                        {def.id === 'caesar' && (
                          <div className="sanctum-field">
                            <label htmlFor={`${n.id}-shift`}>SHIFT PARAM</label>
                            <div className="sanctum-field-row">
                              <input
                                id={`${n.id}-shift`}
                                type="number"
                                value={String(n.config.shift ?? '')}
                                onChange={(e) =>
                                  updateConfig(n.id, {
                                    shift: e.target.value === '' ? '' : Number(e.target.value),
                                  })
                                }
                              />
                              <span className="sanctum-hex-tag">{shiftHexLabel(n.config.shift)}</span>
                            </div>
                          </div>
                        )}
                        {def.id === 'vigenere' && (
                          <div className="sanctum-field">
                            <label htmlFor={`${n.id}-kw`}>KEYPHRASE</label>
                            <input
                              id={`${n.id}-kw`}
                              type="text"
                              value={String(n.config.keyword ?? '')}
                              onChange={(e) => updateConfig(n.id, { keyword: e.target.value })}
                            />
                          </div>
                        )}
                        {def.id === 'xor_b64' && (
                          <div className="sanctum-field">
                            <label htmlFor={`${n.id}-key`}>SECRET KEY</label>
                            <input
                              id={`${n.id}-key`}
                              type="text"
                              value={String(n.config.key ?? '')}
                              onChange={(e) => updateConfig(n.id, { key: e.target.value })}
                            />
                          </div>
                        )}
                        {def.id === 'affine' && (
                          <div className="sanctum-field">
                            <label htmlFor={`${n.id}-a`}>PARAM A (COPRIME 26)</label>
                            <div className="sanctum-field-row">
                              <input
                                id={`${n.id}-a`}
                                type="number"
                                value={String(n.config.a ?? '')}
                                onChange={(e) =>
                                  updateConfig(n.id, {
                                    a: e.target.value === '' ? '' : Number(e.target.value),
                                  })
                                }
                              />
                              <input
                                id={`${n.id}-b`}
                                type="number"
                                value={String(n.config.b ?? '')}
                                onChange={(e) =>
                                  updateConfig(n.id, {
                                    b: e.target.value === '' ? '' : Number(e.target.value),
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}
                        {def.id === 'rail_fence' && (
                          <div className="sanctum-field">
                            <label htmlFor={`${n.id}-rails`}>RAILS / START DIRECTION</label>
                            <div className="sanctum-field-row">
                              <input
                                id={`${n.id}-rails`}
                                type="number"
                                min={2}
                                max={12}
                                value={String(n.config.rails ?? '')}
                                onChange={(e) =>
                                  updateConfig(n.id, {
                                    rails: e.target.value === '' ? '' : Number(e.target.value),
                                  })
                                }
                              />
                              <label className="sanctum-check">
                                <input
                                  type="checkbox"
                                  checked={toBool(n.config.startDown, true)}
                                  onChange={(e) => updateConfig(n.id, { startDown: e.target.checked })}
                                />
                                top-down
                              </label>
                            </div>
                          </div>
                        )}
                        {def.id === 'columnar' && (
                          <>
                            <div className="sanctum-field">
                              <label htmlFor={`${n.id}-col-kw`}>COLUMN KEYWORD</label>
                              <input
                                id={`${n.id}-col-kw`}
                                type="text"
                                value={String(n.config.keyword ?? '')}
                                onChange={(e) => updateConfig(n.id, { keyword: e.target.value })}
                              />
                            </div>
                            <div className="sanctum-field">
                              <label htmlFor={`${n.id}-pad`}>PAD CHAR (ENCRYPT)</label>
                              <input
                                id={`${n.id}-pad`}
                                type="text"
                                maxLength={1}
                                value={String(n.config.padChar ?? '')}
                                onChange={(e) => updateConfig(n.id, { padChar: e.target.value.slice(0, 1) })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="sanctum-node-io">
                        <div className="sanctum-io-pair">
                          <span className="sanctum-io-tag">IN</span>
                          <div className={`sanctum-io-box${step ? '' : ' sanctum-io-box--empty'}`}>
                            {step ? step.input : '—'}
                          </div>
                        </div>
                        <div className="sanctum-io-pair">
                          <span className="sanctum-io-tag">{outLabel}</span>
                          <div className={`sanctum-io-box${step ? '' : ' sanctum-io-box--empty'}`}>
                            {step ? secondReadout : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="sanctum-bottom-io">
              <div className="sanctum-io-panel">
                <div className="sanctum-io-panel-head sanctum-io-panel-head--left">
                  <div className="sanctum-io-panel-title sanctum-io-panel-title--green">SYSTEM_INPUT.TXT</div>
                  <div className="sanctum-io-mode" role="tablist" aria-label="Input type">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'encrypt'}
                      className={mode === 'encrypt' ? 'active' : ''}
                      onClick={() => setMode('encrypt')}
                    >
                      PLAIN
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'decrypt'}
                      className={mode === 'decrypt' ? 'active' : ''}
                      onClick={() => setMode('decrypt')}
                    >
                      CIPHER
                    </button>
                  </div>
                </div>
                {mode === 'encrypt' ? (
                  <textarea
                    className="sanctum-io-textarea"
                    value={plaintext}
                    onChange={(e) => {
                      const v = e.target.value
                      setPlaintext(v)
                      if (v === '') clearOutputs()
                      else markStale()
                    }}
                    spellCheck={false}
                  />
                ) : (
                  <textarea
                    className="sanctum-io-textarea"
                    value={ciphertext}
                    onChange={(e) => {
                      const v = e.target.value
                      setCiphertext(v)
                      if (v === '') clearOutputs()
                      else markStale()
                    }}
                    spellCheck={false}
                  />
                )}
              </div>
              <div className="sanctum-io-panel sanctum-io-panel--out">
                <div className="sanctum-io-panel-head">
                  <div className="sanctum-io-panel-title sanctum-io-panel-title--green">CRYPTED_RESULT.BIN</div>
                  <button
                    type="button"
                    className={`sanctum-copy${copyFlash ? ' sanctum-copy--flash' : ''}`}
                    onClick={copyResult}
                    title="Copy output"
                    aria-label="Copy output"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.5L14.5 4H10a2 2 0 00-2 2z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M6 8H5a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                </div>
                <textarea
                  className="sanctum-io-textarea sanctum-io-textarea--readonly"
                  readOnly
                  value={finalOut ?? ''}
                  placeholder="···"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="sanctum-io-actions">
              <button
                type="button"
                className="sanctum-pill sanctum-pill--decrypt"
                onClick={() => {
                  if (validationHint) {
                    setRunError(validationHint)
                    return
                  }
                  const ct = ciphertext.trim() || (finalOut ?? '').trim()
                  if (!ct) {
                    setRunError('No ciphertext: run ENCRYPT first or paste ciphertext.')
                    return
                  }
                  applyDecryptRun(ct)
                }}
              >
                DECRYPT
              </button>
              <button
                type="button"
                className="sanctum-pill sanctum-pill--encrypt"
                onClick={() => {
                  if (validationHint) {
                    setRunError(validationHint)
                    return
                  }
                  applyEncryptRun()
                }}
              >
                ENCRYPT
              </button>
            </div>

          </section>
        </main>
      </div>

      <footer className="sanctum-statusbar">
        <span className="sanctum-status-item">
          <span className="sanctum-status-dot" /> IDLE
        </span>
        <span className="sanctum-status-item">
          ⏱ {lastLatencyMs != null ? `${lastLatencyMs.toFixed(2)}MS` : '—'} LATENCY
        </span>
        <span className="sanctum-status-item">⬡ {nodes.length} NODES ACTIVE</span>
        <span className="sanctum-status-item sanctum-status-session">SECURE SESSION ID: {sessionId}</span>
      </footer>
    </div>
  )
}
