import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cipherListOrdered, getCipher } from './ciphers/registry'
import type { CipherConfig } from './ciphers/types'
import {
  MIN_PIPELINE_NODES,
  runBackward,
  runForward,
  type PipelineNode,
  type TraceStep,
} from './lib/executor'

const NODE_W = 320
/** Fallback before ResizeObserver measures auto-sized nodes */
const NODE_H_FALLBACK = 200
const CANVAS_PAD = 56
const CANVAS_MIN_H = 400
const SPAWN_X0 = 64
const SPAWN_Y0 = 100
const NODE_H_GAP = 40
const NODE_V_GAP = 52

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

/** Place the next node to the right of the last, or start a new row when the canvas is not wide enough. */
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

/** Swap pipeline slots `left` and `right` (left < right) and exchange their canvas positions. */
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

type Mode = 'encrypt' | 'decrypt'

type DragState = { id: string; offsetX: number; offsetY: number }

export default function App() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const nodeHeightsRef = useRef<Record<string, number>>({})
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({})
  const [nodes, setNodes] = useState<PipelineCanvasNode[]>([])
  const [mode, setMode] = useState<Mode>('encrypt')
  const [plaintext, setPlaintext] = useState('hello')
  const [ciphertext, setCiphertext] = useState('')
  const [traceByNodeId, setTraceByNodeId] = useState<Record<string, TraceStep>>({})
  const [finalOut, setFinalOut] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [reorderMessage, setReorderMessage] = useState<string | null>(null)

  const pipeline = useMemo(() => toPipeline(nodes), [nodes])

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
      setNodes((prev) => {
        const innerW =
          canvasRef.current?.clientWidth ??
          (typeof window !== 'undefined' ? window.innerWidth : 1200)
        const pos = spawnPosition(prev, innerW, nodeHeightsRef.current)
        return [...prev, { id: newId(), cipherId, config: cloneConfig(cipherId), ...pos }]
      })
      clearOutputs()
    },
    [clearOutputs],
  )

  const removeNode = useCallback(
    (id: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== id))
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
        return copy
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
        return copy
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

  const run = useCallback(() => {
    setStale(false)
    setRunError(null)
    const input = mode === 'encrypt' ? plaintext : ciphertext
    const res = mode === 'encrypt' ? runForward(pipeline, input) : runBackward(pipeline, input)
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
    if (mode === 'encrypt') {
      setCiphertext(res.finalOutput)
    } else {
      setPlaintext(res.finalOutput)
    }
  }, [mode, pipeline, plaintext, ciphertext])

  const validationHint = useMemo(() => {
    if (nodes.length === 0) return 'Click a cipher in the library to place a node on the canvas.'
    if (nodes.length < MIN_PIPELINE_NODES) {
      return `Add at least ${MIN_PIPELINE_NODES} nodes (currently ${nodes.length}). Drag nodes to arrange.`
    }
    for (const n of nodes) {
      const def = getCipher(n.cipherId)
      if (!def) return 'Unknown node type.'
      const issues = def.validateConfig(n.config)
      if (issues.length) return issues[0]!.message
    }
    return null
  }, [nodes])

  const roundTripOk = useMemo(() => {
    if (!ciphertext || nodes.length < MIN_PIPELINE_NODES) return null
    const enc = runForward(pipeline, plaintext)
    if (!enc.ok) return false
    if (enc.finalOutput !== ciphertext) return false
    const dec = runBackward(pipeline, ciphertext)
    if (!dec.ok) return false
    return dec.finalOutput === plaintext
  }, [pipeline, plaintext, ciphertext, nodes.length])

  const edgeSegments = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; key: string }[] = []
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]!
      const b = nodes[i + 1]!
      const ha = nodeHeights[a.id] ?? NODE_H_FALLBACK
      const hb = nodeHeights[b.id] ?? NODE_H_FALLBACK
      out.push({
        key: `${a.id}-${b.id}`,
        x1: a.x + NODE_W / 2,
        y1: a.y + ha / 2,
        x2: b.x + NODE_W / 2,
        y2: b.y + hb / 2,
      })
    }
    return out
  }, [nodes, nodeHeights])

  const canvasExtent = useMemo(() => {
    if (nodes.length === 0) {
      return { right: NODE_W + CANVAS_PAD, bottom: CANVAS_MIN_H }
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

  return (
    <main className={`app${drag ? ' app--dragging' : ''}`}>
      <header className="app-header app-header--compact" data-reveal>
        <div>
          <p className="app-kicker" aria-hidden="true">
            Build · run · trace
          </p>
          <h1>CipherStack</h1>
          <p>
            Place nodes on the canvas and drag them freely. <strong>Before</strong> / <strong>After</strong>{' '}
            swap a step with its neighbor in the chain and trade canvas positions. Add more steps from the
            library above.
          </p>
        </div>
      </header>

      <div className="panel panel-top palette-panel" data-reveal>
        <div className="panel-top-head">
          <h2>Node library</h2>
          <span className="panel-top-hint">
            Click a cipher to add a node · <strong>Before</strong> / <strong>After</strong> reorder adjacent
            steps (and swap their on-canvas positions). Drag the header only moves a box.
          </span>
        </div>
        <div className="palette-row">
          {cipherListOrdered.map((c) => (
            <button
              key={c.id}
              type="button"
              className="palette-chip"
              onClick={() => addCipher(c.id)}
            >
              <span className="palette-chip-label">{c.label}</span>
              {c.countsAsConfigurable ? (
                <span className="badge">cfg</span>
              ) : (
                <span className="badge extra">extra</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="panel panel-top io-panel" data-reveal>
        <div className="io-row">
          <div className="io-cluster io-cluster--modes">
            <h2 className="io-inline-title">I/O</h2>
            <div className="mode-toggle mode-toggle--compact">
              <button
                type="button"
                className={mode === 'encrypt' ? 'active' : ''}
                onClick={() => setMode('encrypt')}
              >
                Encrypt
              </button>
              <button
                type="button"
                className={mode === 'decrypt' ? 'active' : ''}
                onClick={() => {
                  if (mode === 'encrypt') {
                    setCiphertext('')
                    clearOutputs()
                  }
                  setMode('decrypt')
                }}
              >
                Decrypt
              </button>
            </div>
          </div>

          <div className="io-cluster io-cluster--grow">
            <label className="io-inline-label" htmlFor={mode === 'encrypt' ? 'plain' : 'cipher'}>
              {mode === 'encrypt' ? 'Plaintext' : 'Ciphertext'}
            </label>
            {mode === 'encrypt' ? (
              <textarea
                id="plain"
                className="io-text io-text--main"
                value={plaintext}
                onChange={(e) => {
                  const v = e.target.value
                  setPlaintext(v)
                  if (v === '') clearOutputs()
                  else markStale()
                }}
                rows={3}
              />
            ) : (
              <textarea
                id="cipher"
                className="io-text io-text--main"
                value={ciphertext}
                onChange={(e) => {
                  const v = e.target.value
                  setCiphertext(v)
                  if (v === '') clearOutputs()
                  else markStale()
                }}
                rows={3}
              />
            )}
          </div>

          <div className="io-cluster io-cluster--actions">
            <button type="button" className="btn-run" disabled={!!validationHint} onClick={run}>
              Run {mode === 'encrypt' ? 'encrypt' : 'decrypt'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const dec = runBackward(pipeline, ciphertext)
                if (!dec.ok) {
                  setRunError(dec.error)
                  setTraceByNodeId({})
                  setFinalOut(null)
                  return
                }
                const map: Record<string, TraceStep> = {}
                for (const s of dec.steps) {
                  map[s.nodeId] = s
                }
                setTraceByNodeId(map)
                setFinalOut(dec.finalOutput)
                setPlaintext(dec.finalOutput)
                setRunError(null)
                setStale(false)
                setMode('decrypt')
              }}
              disabled={!!validationHint || !ciphertext}
            >
              Quick decrypt
            </button>
          </div>

          <div className="io-cluster io-cluster--grow">
            <span className="io-inline-label">Result</span>
            <textarea
              className="io-text"
              readOnly
              placeholder="Run to see output…"
              value={finalOut ?? ''}
              rows={3}
            />
          </div>

          {roundTripOk !== null && nodes.length >= MIN_PIPELINE_NODES && (
            <div className={`io-cluster io-roundtrip ${roundTripOk ? 'ok' : 'bad'}`}>
              Round-trip: {roundTripOk ? 'PASS' : 'FAIL'}
            </div>
          )}
        </div>
      </div>

      {(runError || stale || validationHint || reorderMessage) && (
        <div className="alerts-strip" data-reveal>
          {runError && <div className="alert warn">{runError}</div>}
          {stale && !runError && (
            <div className="alert stale">Config or text changed — run again to refresh traces.</div>
          )}
          {validationHint && <div className="alert info">{validationHint}</div>}
          {reorderMessage && <div className="alert error" role="status">{reorderMessage}</div>}
        </div>
      )}

      <section className="panel panel-canvas-wrap" data-reveal>
        <div className="canvas-head">
          <h2>Pipeline canvas</h2>
          <span className="canvas-hint">
            Drag the header to move a box on the canvas. Arrows follow pipeline order (step 1 → 2 → …).{' '}
            <strong>Before</strong> / <strong>After</strong> swap with the previous or next step and trade places on
            the canvas.
          </span>
        </div>
        <div
          ref={canvasRef}
          className="canvas"
          style={{
            width: `max(100%, ${canvasExtent.right}px)`,
            height: `${canvasExtent.bottom}px`,
          }}
        >
          <svg
            className="canvas-edges"
            aria-hidden="true"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="55%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#0d9488" />
              </linearGradient>
              <marker
                id="edge-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f46e5" />
              </marker>
            </defs>
            {edgeSegments.map((seg) => (
              <line
                key={seg.key}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="url(#edgeGrad)"
                strokeWidth="2.5"
                markerEnd="url(#edge-arrow)"
              />
            ))}
          </svg>

          {nodes.length === 0 && (
            <div className="canvas-empty">Choose a cipher above — it will land here. Add more to link them.</div>
          )}

          {nodes.map((n, i) => {
            const def = getCipher(n.cipherId)
            if (!def) return null
            const step = traceByNodeId[n.id]
            const isDragging = drag?.id === n.id
            return (
              <article
                key={n.id}
                data-node-box={n.id}
                className={`node-box node-box--canvas${isDragging ? ' node-box--dragging' : ''}`}
                style={{ left: n.x, top: n.y, width: NODE_W }}
              >
                <div
                  className="node-box-drag"
                  onPointerDown={(e) => beginDrag(e, n)}
                  title="Drag to move this box on the canvas only (does not change pipeline order)"
                >
                  <strong className="node-box-title">{def.label}</strong>
                  <span className="node-drag-grip" aria-hidden>
                    ⠿
                  </span>
                  <button
                    type="button"
                    className="node-box-remove"
                    title="Remove this step from the pipeline"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeNode(n.id)
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="node-box-nav">
                  <div
                    className="node-order-badge"
                    title="Steps run in this order. Before/After swap with the neighbor step and move both boxes. Drag only moves one box."
                  >
                    Pipeline step {i + 1} of {nodes.length}
                  </div>
                  <div className="node-box-nav-buttons node-box-nav-buttons--pair">
                    <button
                      type="button"
                      className="node-btn-before"
                      onClick={() => swapWithPreviousInPipeline(i)}
                      title="Swap this step with the previous one in the chain and trade canvas positions."
                    >
                      Before
                      <span className="node-btn-sub">swap with previous</span>
                    </button>
                    <button
                      type="button"
                      className="node-btn-after"
                      onClick={() => swapWithNextInPipeline(i)}
                      title="Swap this step with the next one in the chain and trade canvas positions."
                    >
                      After
                      <span className="node-btn-sub">swap with next</span>
                    </button>
                  </div>
                </div>
                <div className="node-box-body">
                  <div className="node-box-config">
                    {def.id === 'caesar' && (
                      <div className="field field-node">
                        <label htmlFor={`${n.id}-shift`}>Shift</label>
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
                      </div>
                    )}
                    {def.id === 'vigenere' && (
                      <div className="field field-node">
                        <label htmlFor={`${n.id}-kw`}>Key</label>
                        <input
                          id={`${n.id}-kw`}
                          type="text"
                          value={String(n.config.keyword ?? '')}
                          onChange={(e) => updateConfig(n.id, { keyword: e.target.value })}
                        />
                      </div>
                    )}
                    {def.id === 'xor_b64' && (
                      <div className="field field-node">
                        <label htmlFor={`${n.id}-key`}>XOR key</label>
                        <input
                          id={`${n.id}-key`}
                          type="text"
                          value={String(n.config.key ?? '')}
                          onChange={(e) => updateConfig(n.id, { key: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                  <div className="node-io">
                    <div className="node-io-block">
                      <label className="node-io-label">Input</label>
                      <div
                        className={`node-io-readout${step ? '' : ' node-io-readout--empty'}`}
                        tabIndex={-1}
                      >
                        {step ? step.input : 'Run pipeline to populate.'}
                      </div>
                    </div>
                    <div className="node-io-block">
                      <label className="node-io-label">Output</label>
                      <div
                        className={`node-io-readout${step ? '' : ' node-io-readout--empty'}`}
                        tabIndex={-1}
                      >
                        {step ? step.output : 'Run pipeline to populate.'}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}
