import { Component, lazy, Suspense, useEffect, useMemo, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { glQuality } from '../render/gl'
import type { AssetEntry } from './catalog'

/**
 * The WebGL view of one hand-built model (react-three-fiber). Loaded on demand by the asset3d card, so
 * neither three.js nor react-three-fiber is in the main bundle. Lights and tone mapping follow the
 * sandbox the models were made for (LoominPhysicsSandbox, app/editor/PhysicsScene.jsx).
 */

/** Where the camera is, as an orbit around the asset's target. The card changes it; the view reads it each frame. */
export interface Orbit {
  /** angle around the vertical axis, radians */
  az: number
  /** angle down from straight above, radians */
  pol: number
  dist: number
}

export function startOrbit(entry: AssetEntry): Orbit {
  const dx = entry.camera[0] - entry.target[0]
  const dy = entry.camera[1] - entry.target[1]
  const dz = entry.camera[2] - entry.target[2]
  const dist = Math.hypot(dx, dy, dz) || 1
  return { az: Math.atan2(dx, dz), pol: Math.acos(Math.max(-1, Math.min(1, dy / dist))), dist }
}

function Rig({ entry, orbit }: { entry: AssetEntry; orbit: RefObject<Orbit> }) {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const { az, pol, dist } = orbit.current
    const [tx, ty, tz] = entry.target
    const flat = Math.sin(pol) * dist
    camera.position.set(tx + flat * Math.sin(az), ty + dist * Math.cos(pol), tz + flat * Math.cos(az))
    camera.lookAt(tx, ty, tz)
  })
  return null
}

function Ready({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady])
  return null
}

class Boundary extends Component<{ onError: (err: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    this.props.onError(err)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export interface AssetStageProps {
  entry: AssetEntry
  params: Record<string, number>
  /** false while the card is off screen: the frame loop stops */
  running: boolean
  orbit: RefObject<Orbit>
  onReady: () => void
  /** the model or WebGL failed */
  onError: (err: unknown) => void
  /** the browser took the WebGL context away (memory pressure) */
  onLost: () => void
}

export default function AssetStage({ entry, params, running, orbit, onReady, onError, onLost }: AssetStageProps) {
  const Model = useMemo(() => lazy(entry.load), [entry])
  const simConfig = useMemo(() => ({ constraints: entry.constraints ?? [] }), [entry])
  // some models set themselves up once; these parameters need a fresh one
  // no antialiasing on a touch device (iPad memory); read once, the renderer is made once
  const antialias = useMemo(() => glQuality().antialias, [])
  const modelKey = (entry.remountOn ?? []).map((k) => params[k]).join('|')
  return (
    <Boundary onError={onError}>
      <Canvas
        frameloop={running ? 'always' : 'never'}
        dpr={[1, 1.5]}
        // the card sits inside tldraw's zoomed page: measure the layout size, not the size on screen
        resize={{ offsetSize: true, scroll: false }}
        camera={{ fov: entry.fov, position: entry.camera, near: 0.1, far: 300 }}
        gl={{ antialias, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
        style={{ position: 'absolute', inset: 0 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            onLost()
          })
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 20, 10]} intensity={1.6} />
        <directionalLight position={[-5, 10, -5]} intensity={0.5} color="#b4c6ef" />
        <pointLight position={[-8, 5, -8]} intensity={0.35} color="#ffd4a3" />
        <pointLight position={[0, 8, 0]} intensity={0.2} color="#c7d5f0" />
        {/* fill, so the dark parts of a model still read on a small card (the sandbox adds these for generated scenes) */}
        <hemisphereLight intensity={0.9} color="#f8fbff" groundColor="#3a4660" />
        <directionalLight position={[-6, 8, 6]} intensity={0.8} color="#dbeafe" />
        <Rig entry={entry} orbit={orbit} />
        <Suspense fallback={null}>
          <Model key={modelKey} params={params} simConfig={simConfig} />
          <Ready onReady={onReady} />
        </Suspense>
      </Canvas>
    </Boundary>
  )
}
