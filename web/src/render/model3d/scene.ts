import * as THREE from 'three'
import type { Model3dFigure, ModelPart } from '../../contract'
import { LOAD_ARROW_COLOR, LOAD_COLORS, memberAxis, memberRadius, modelBounds, pickRadius, type ModelMark } from './geometry'

/**
 * Engineering (Part 2): a WebGL view of a model3d figure. One mesh per part, coloured by the force it carries,
 * green arrows for the outside loads. Draws only when something changes (no animation loop), like the 3D surface.
 * Tapping picks a part by name (a cable drawn in pieces is one part).
 */

const MAX_ELEVATION = (85 * Math.PI) / 180
const FOV = 32

export interface ModelView {
  rotateBy(dx: number, dy: number): void
  /** >1 moves closer */
  zoomBy(factor: number): void
  resize(w: number, h: number): void
  /** The part name under (x, y) CSS pixels inside the view, or null. */
  pick(x: number, y: number): string | null
  /** Highlight every part with this name and fade the rest; null shows everything normally. */
  select(name: string | null): void
  /**
   * Stick a stroke drawn on the view (CSS pixels inside it) onto the model: each point lands on the part under it,
   * just off its surface; points over empty space land on a plane through the model facing the camera.
   */
  project(points: [number, number][]): number[]
  /** Draw these marks (replacing the ones drawn before). */
  setMarks(marks: ModelMark[]): void
  dispose(): void
}

function labelSprite(text: string, color: string, height: number, disposables: { dispose(): void }[]): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const font = '600 44px system-ui, sans-serif'
  const measure = canvas.getContext('2d')!
  measure.font = font
  canvas.width = Math.ceil(measure.measureText(text).width) + 20
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(0, 6, canvas.width, 52)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  disposables.push(texture, material)
  const sprite = new THREE.Sprite(material)
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  sprite.renderOrder = 10
  return sprite
}

const UP = new THREE.Vector3(0, 1, 0) // three.js cylinders stand on y

function partGeometry(p: ModelPart, radius: number, pickSleeve = false): { geometry: THREE.BufferGeometry; place(m: THREE.Object3D): void } | null {
  if (p.shape === 'member' && p.start && p.end) {
    const { mid, length, dir } = memberAxis(p.start, p.end)
    const r = pickSleeve ? Math.max(pickRadius(radius), memberRadius(p, radius)) : memberRadius(p, radius)
    return {
      geometry: new THREE.CylinderGeometry(r, r, length, pickSleeve ? 6 : 12),
      place(m) {
        m.position.set(...mid)
        m.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir))
      },
    }
  }
  if (!p.at || !p.size || pickSleeve) return null
  const [sx, sy, sz] = p.size
  const geometry =
    p.shape === 'box'
      ? new THREE.BoxGeometry(sx, sy, sz)
      : p.shape === 'sphere'
        ? new THREE.SphereGeometry(sx, 20, 14)
        : new THREE.CylinderGeometry(sx, sx, sz, 24)
  return {
    geometry,
    place(m) {
      m.position.set(...p.at!)
      if (p.shape === 'cylinder') m.rotation.x = Math.PI / 2 // stand it on z
    },
  }
}

/** Mount a view of `model` inside `host`. Throws if WebGL isn't available. Call dispose() to free the GL context. */
export function createModelView(host: HTMLElement, model: Model3dFigure, w: number, h: number): ModelView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
  const disposables: { dispose(): void }[] = []
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(0xf7f9fc, 1)
  renderer.setSize(w, h, false)
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  host.appendChild(canvas)

  const bounds = modelBounds(model)
  const R = bounds.radius
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, w / Math.max(1, h), R * 0.01, R * 40)
  camera.up.set(0, 0, 1)
  const target = new THREE.Vector3(...bounds.center)
  // most structures are long and flat, so the sphere around them is mostly empty: start closer than it
  let distance = (R / Math.sin(((FOV / 2) * Math.PI) / 180)) * 0.72

  // ---- the parts
  const meshesByName = new Map<string, THREE.Mesh[]>()
  const pickables: THREE.Mesh[] = []
  for (const p of model.parts) {
    const g = partGeometry(p, R)
    if (!g) continue
    const material = new THREE.MeshStandardMaterial({ color: LOAD_COLORS[p.load], roughness: 0.6, metalness: 0.05, transparent: true })
    const mesh = new THREE.Mesh(g.geometry, material)
    g.place(mesh)
    mesh.userData.name = p.name
    scene.add(mesh)
    disposables.push(g.geometry, material)
    meshesByName.set(p.name, [...(meshesByName.get(p.name) ?? []), mesh])
    // thin members get a fat invisible sleeve so a finger can hit them
    const sleeve = partGeometry(p, R, true)
    if (sleeve) {
      const hidden = new THREE.MeshBasicMaterial({ visible: false })
      const s = new THREE.Mesh(sleeve.geometry, hidden)
      sleeve.place(s)
      s.userData.name = p.name
      scene.add(s)
      pickables.push(s)
      disposables.push(sleeve.geometry, hidden)
    } else pickables.push(mesh)
  }

  // ---- outside loads: green arrows pointing at where they act, labelled
  for (const l of model.loads ?? []) {
    const dir = new THREE.Vector3(...l.dir).normalize()
    const len = R * 0.35
    const at = new THREE.Vector3(...l.at)
    const from = at.clone().addScaledVector(dir, -len)
    const arrow = new THREE.ArrowHelper(dir, from, len, LOAD_ARROW_COLOR, len * 0.28, len * 0.16)
    scene.add(arrow)
    disposables.push(arrow.line.geometry, arrow.cone.geometry, arrow.line.material as THREE.Material, arrow.cone.material as THREE.Material)
    const label = labelSprite(l.label, LOAD_ARROW_COLOR, R * 0.1, disposables)
    label.position.copy(from.clone().addScaledVector(dir, -R * 0.05))
    scene.add(label)
  }

  // ---- ground grid under the model
  const groundZ = bounds.min[2]
  const grid = new THREE.GridHelper(R * 2.2, 16, 0xd5dae3, 0xe6e9ef)
  grid.rotation.x = Math.PI / 2
  grid.position.set(bounds.center[0], bounds.center[1], groundZ)
  scene.add(grid)
  disposables.push(grid.geometry, grid.material as THREE.Material)

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc6, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  scene.add(key)

  let azimuth = -Math.PI / 2.6
  let elevation = Math.PI / 7
  let disposed = false

  const draw = () => {
    if (disposed) return
    const c = Math.cos(elevation)
    camera.position.set(
      target.x + distance * c * Math.cos(azimuth),
      target.y + distance * c * Math.sin(azimuth),
      target.z + distance * Math.sin(elevation),
    )
    camera.lookAt(target)
    key.position.copy(camera.position).add(new THREE.Vector3(0, 0, R))
    renderer.render(scene, camera)
  }
  draw()

  const onLost = (e: Event) => e.preventDefault()
  const onRestored = () => draw()
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  const raycaster = new THREE.Raycaster()
  const ray = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2((x / (rect.width || 1)) * 2 - 1, -(y / (rect.height || 1)) * 2 + 1), camera)
    return raycaster
  }
  const solids = [...meshesByName.values()].flat()

  // ---- the student's marks: tubes (WebGL lines are always 1 px), redrawn whenever they change
  const marks = new THREE.Group()
  marks.renderOrder = 5
  scene.add(marks)
  const markDisposables: { dispose(): void }[] = []
  const clearMarks = () => {
    for (const d of markDisposables.splice(0)) d.dispose()
    marks.clear()
  }

  return {
    rotateBy(dx, dy) {
      azimuth -= dx * 0.01
      elevation = Math.min(MAX_ELEVATION, Math.max(-0.2, elevation + dy * 0.01))
      draw()
    },
    zoomBy(factor) {
      const fit = R / Math.sin(((FOV / 2) * Math.PI) / 180)
      distance = Math.min(fit * 2.5, Math.max(fit * 0.25, distance / factor))
      draw()
    },
    resize(nw, nh) {
      renderer.setSize(nw, nh, false)
      camera.aspect = nw / Math.max(1, nh)
      camera.updateProjectionMatrix()
      draw()
    },
    pick(x, y) {
      const hit = ray(x, y).intersectObjects(pickables, false)[0]
      return (hit?.object.userData.name as string | undefined) ?? null
    },
    project(points) {
      if (!points.length) return []
      const out: number[] = []
      const hits = points.map(([x, y]) => {
        const hit = ray(x, y).intersectObjects(solids, false)[0]
        if (!hit) return null
        // a little off the surface, toward the camera, so the stroke isn't buried in it
        const toward = camera.position.clone().sub(hit.point).normalize()
        return hit.point.clone().addScaledVector(toward, R * 0.006)
      })
      // empty space: a plane facing the camera through the first point that hit the model (or the model's centre)
      const anchor = hits.find((h) => h) ?? target.clone()
      const normal = camera.position.clone().sub(target).normalize()
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor)
      points.forEach(([x, y], i) => {
        const p = hits[i] ?? ray(x, y).ray.intersectPlane(plane, new THREE.Vector3())
        if (p) out.push(+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3))
      })
      return out
    },
    setMarks(list) {
      clearMarks()
      for (const m of list) {
        const pts: THREE.Vector3[] = []
        for (let i = 0; i + 2 < m.pts.length; i += 3) pts.push(new THREE.Vector3(m.pts[i], m.pts[i + 1], m.pts[i + 2]))
        const material = new THREE.MeshBasicMaterial({ color: m.color })
        markDisposables.push(material)
        if (pts.length === 1) {
          const dot = new THREE.SphereGeometry(R * 0.008, 10, 8)
          const mesh = new THREE.Mesh(dot, material)
          mesh.position.copy(pts[0])
          marks.add(mesh)
          markDisposables.push(dot)
          continue
        }
        if (pts.length < 2) continue
        const curve = new THREE.CatmullRomCurve3(pts)
        const tube = new THREE.TubeGeometry(curve, Math.min(400, pts.length * 3), R * 0.0045, 6, false)
        marks.add(new THREE.Mesh(tube, material))
        markDisposables.push(tube)
      }
      draw()
    },
    select(name) {
      for (const [n, meshes] of meshesByName) {
        for (const m of meshes) {
          const mat = m.material as THREE.MeshStandardMaterial
          const on = name === null || n === name
          mat.opacity = on ? 1 : 0.18
          mat.depthWrite = on
          mat.emissive.set(name !== null && on ? 0x333333 : 0x000000)
        }
      }
      draw()
    },
    dispose() {
      if (disposed) return
      disposed = true
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      clearMarks()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
