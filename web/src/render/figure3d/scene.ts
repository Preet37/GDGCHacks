import * as THREE from 'three'
import { glQuality } from '../gl'
import { heightColor, surfaceIndices, tickLabel, type SurfaceGrid } from './sample'

/** Half-height of the surface box in scene units (x and y span -1..1). */
const Z_HALF = 0.7
const CAMERA_DISTANCE = 6.3
const MAX_ELEVATION = (89 * Math.PI) / 180

export interface SurfaceView {
  /** Rotate by a drag of (dx, dy) CSS pixels and redraw. */
  rotateBy(dx: number, dy: number): void
  resize(w: number, h: number): void
  dispose(): void
}

function labelSprite(text: string, color: string, scale: number, disposables: { dispose(): void }[]): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const font = '600 44px system-ui, sans-serif'
  const measure = canvas.getContext('2d')!
  measure.font = font
  canvas.width = Math.ceil(measure.measureText(text).width) + 16
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  disposables.push(texture, material)
  const sprite = new THREE.Sprite(material)
  sprite.scale.set((scale * canvas.width) / canvas.height, scale, 1)
  sprite.renderOrder = 10
  return sprite
}

/**
 * Mount a WebGL view of `grid` inside `host`. Draws only when something changes (no animation
 * loop). Throws if WebGL isn't available. Call dispose() to free the GL context.
 */
export function createSurfaceView(host: HTMLElement, grid: SurfaceGrid, w: number, h: number): SurfaceView {
  const quality = glQuality() // lighter on a touch device (iPad memory)
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: false, powerPreference: 'low-power' })
  const disposables: { dispose(): void }[] = []
  renderer.setPixelRatio(quality.pixelRatio)
  renderer.setClearColor(0xffffff, 1)
  renderer.setSize(w, h, false)
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  host.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, w / Math.max(1, h), 0.1, 50)
  camera.up.set(0, 0, 1) // math convention: z is up

  // ---- surface mesh, normalised into x,y in [-1,1], z in [-Z_HALF, Z_HALF]
  const { n, z, z_range } = grid
  const count = (n + 1) * (n + 1)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const zSpan = z_range[1] - z_range[0]
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i
      const t = Number.isNaN(z[k]) ? 0 : (z[k] - z_range[0]) / zSpan
      positions[k * 3] = (i / n) * 2 - 1
      positions[k * 3 + 1] = (j / n) * 2 - 1
      positions[k * 3 + 2] = (t * 2 - 1) * Z_HALF
      const [r, g, b] = heightColor(t)
      colors[k * 3] = r
      colors[k * 3 + 1] = g
      colors[k * 3 + 2] = b
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(surfaceIndices(grid))
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.65,
    metalness: 0,
    polygonOffset: true, // keeps the mesh lines below from z-fighting
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  scene.add(new THREE.Mesh(geometry, material))
  disposables.push(geometry, material)

  // ---- thin mesh lines on the surface every few cells, so the shape reads without shading
  const step = Math.max(1, Math.round(n / 12))
  const linePts: number[] = []
  const seg = (a: number, b: number) => {
    if (Number.isNaN(z[a]) || Number.isNaN(z[b])) return
    linePts.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2], positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2])
  }
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i
      if (j % step === 0 && i < n) seg(k, k + 1)
      if (i % step === 0 && j < n) seg(k, k + n + 1)
    }
  }
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3))
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x1d1d1d, transparent: true, opacity: 0.28 })
  scene.add(new THREE.LineSegments(lineGeometry, lineMaterial))
  disposables.push(lineGeometry, lineMaterial)

  // ---- light box around it + a grid on the floor
  const boxGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, Z_HALF * 2))
  const boxMaterial = new THREE.LineBasicMaterial({ color: 0xb8b8b8 })
  scene.add(new THREE.LineSegments(boxGeometry, boxMaterial))
  disposables.push(boxGeometry, boxMaterial)

  const floorPts: number[] = []
  for (let k = 1; k < 8; k++) {
    const v = (k / 8) * 2 - 1
    floorPts.push(v, -1, -Z_HALF, v, 1, -Z_HALF, -1, v, -Z_HALF, 1, v, -Z_HALF)
  }
  const floorGeometry = new THREE.BufferGeometry()
  floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorPts, 3))
  const floorMaterial = new THREE.LineBasicMaterial({ color: 0xe4e4e4 })
  scene.add(new THREE.LineSegments(floorGeometry, floorMaterial))
  disposables.push(floorGeometry, floorMaterial)

  // ---- axis names and the ends of each range
  const put = (text: string, x: number, y: number, zz: number, color = '#666', scale = 0.15) => {
    const s = labelSprite(text, color, scale, disposables)
    s.position.set(x, y, zz)
    scene.add(s)
  }
  const off = 0.16
  const zb = -Z_HALF
  put('x', 0, -1 - off * 1.4, zb, '#222', 0.19)
  put(tickLabel(grid.x_range[0]), -1, -1 - off, zb)
  put(tickLabel(grid.x_range[1]), 1, -1 - off, zb)
  put('y', 1 + off * 1.4, 0, zb, '#222', 0.19)
  put(tickLabel(grid.y_range[0]), 1 + off, -1, zb)
  put(tickLabel(grid.y_range[1]), 1 + off, 1, zb)
  put('z', -1 - off, 1 + off, 0, '#222', 0.19)
  put(tickLabel(z_range[0]), -1 - off, 1 + off, -Z_HALF)
  put(tickLabel(z_range[1]), -1 - off, 1 + off, Z_HALF)

  // ---- lighting: soft fill + a key light that travels with the camera so no side goes dark
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  scene.add(key)

  let azimuth = -Math.PI / 3
  let elevation = Math.PI / 6
  let disposed = false

  const draw = () => {
    if (disposed) return
    const c = Math.cos(elevation)
    camera.position.set(CAMERA_DISTANCE * c * Math.cos(azimuth), CAMERA_DISTANCE * c * Math.sin(azimuth), CAMERA_DISTANCE * Math.sin(elevation))
    camera.lookAt(0, 0, 0)
    key.position.copy(camera.position).add(new THREE.Vector3(0, 0, 3))
    renderer.render(scene, camera)
  }
  draw()

  // iPad Safari drops GL contexts under memory pressure; redraw when it gives one back
  const onLost = (e: Event) => e.preventDefault()
  const onRestored = () => draw()
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    rotateBy(dx, dy) {
      azimuth -= dx * 0.01
      elevation = Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, elevation + dy * 0.01))
      draw()
    },
    resize(nw, nh) {
      renderer.setSize(nw, nh, false)
      camera.aspect = nw / Math.max(1, nh)
      camera.updateProjectionMatrix()
      draw()
    },
    dispose() {
      if (disposed) return
      disposed = true
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.forceContextLoss() // frees the context now instead of at GC (Safari allows only a few)
      canvas.remove()
    },
  }
}
