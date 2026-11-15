import type { ComponentType } from 'react'

/**
 * The asset library: hand-built, animated 3D models (from Preet's LoominPhysicsSandbox, copied into this
 * folder). When a model3d figure names one of these subjects the page shows the hand-built model instead of
 * asking Gemini to build one from boxes and cylinders (see drawModel3d in ../render/figure.ts).
 *
 * This file is plain data plus one pure function: it imports no 3D code. Each model is loaded on demand.
 */

export interface AssetSlider {
  /** the model's own parameter name (e.g. "Wind_Speed") */
  key: string
  label: string
  min: number
  max: number
  step: number
  /** the model's default for this parameter */
  def: number
  unit: string
}

export type AssetModel = ComponentType<{ params?: Record<string, number>; simConfig?: unknown }>

export interface AssetEntry {
  id: string
  title: string
  /** one or two plain sentences on the physics, shown under the model */
  caption: string
  load: () => Promise<{ default: AssetModel }>
  /** where the camera starts and what it looks at (taken from the sandbox's scene settings) */
  camera: [number, number, number]
  target: [number, number, number]
  fov: number
  sliders: AssetSlider[]
  /** parameters whose change needs the model rebuilt from scratch (its motion restarts) */
  remountOn?: string[]
  /** warning / failure limits handed to the model as `simConfig.constraints` (only where its own defaults are wrong) */
  constraints?: { param: string; warningThreshold: number; criticalThreshold: number }[]
}

interface Rule {
  test: RegExp
  /** text that looks like a match but is about something else */
  not?: RegExp
  entry: AssetEntry
}

const s = (key: string, label: string, min: number, max: number, step: number, def: number, unit: string): AssetSlider => ({
  key,
  label,
  min,
  max,
  step,
  def,
  unit,
})

// Order matters: the first rule that matches wins (e.g. "inverted pendulum" before "pendulum").
const RULES: Rule[] = [
  {
    test: /formula[\s-]?(one|1)\b|\bf-?1\b|\brac(e|ing)[\s-]?cars?\b|\bgrand prix\b/,
    entry: {
      id: 'f1_car',
      title: 'Formula One car',
      caption:
        'The wings are upside-down aerofoils: the air pushes the car down onto the track (downforce), so the tyres grip harder in corners. A steeper rear wing gives more downforce, and also more drag.',
      load: () => import('./PhysicsF1Car.jsx'),
      camera: [4.5, 2.8, 7],
      target: [0, 0.5, 0],
      fov: 42,
      sliders: [
        s('Speed', 'Speed', 0, 360, 10, 200, 'km/h'),
        s('Rear_Wing_Angle', 'Rear wing angle', 0, 35, 1, 12, '°'),
        s('Downforce', 'Downforce', 0, 8000, 100, 3000, 'N'),
      ],
    },
  },
  {
    test: /wind[\s-]?turbines?\b|\bwindmills?\b|\bwind (power|energy|farm)/,
    entry: {
      id: 'wind_turbine',
      title: 'Wind turbine',
      caption:
        'The wind turns the blades, and a generator behind the hub turns that rotation into electricity. The power in the wind grows with the area the blades sweep and with the cube of the wind speed: P = ½ρAv³.',
      load: () => import('./PhysicsWindTurbine.jsx'),
      camera: [13, 9.5, 24],
      target: [0, 7, 0],
      fov: 35,
      sliders: [
        s('Wind_Speed', 'Wind speed', 0, 40, 1, 12, 'm/s'),
        s('Blade_Count', 'Blades', 1, 6, 1, 3, ''),
        s('Rotor_Diameter', 'Rotor diameter', 40, 88, 4, 80, 'm'),
      ],
      remountOn: ['Blade_Count'],
    },
  },
  {
    test: /\bhelicopters?\b|\bchoppers?\b/,
    entry: {
      id: 'helicopter',
      title: 'Helicopter',
      caption:
        'The spinning main rotor pushes air down, and the air pushes the helicopter up: that is lift. Steeper blades (more collective pitch) give more lift. The tail rotor stops the body from spinning the opposite way to the main rotor.',
      load: () => import('./PhysicsHelicopter.jsx'),
      camera: [5, 3.5, 7],
      target: [0, 1.2, 0],
      fov: 44,
      sliders: [
        s('Main_Rotor_RPM', 'Main rotor', 0, 500, 10, 300, 'rpm'),
        s('Collective_Pitch', 'Blade pitch', 0, 22, 1, 10, '°'),
        s('Gross_Weight', 'Weight', 1000, 4500, 100, 3000, 'kg'),
      ],
    },
  },
  {
    test: /\bsteam[\s-]?(engines?|locomotives?|trains?)\b/,
    entry: {
      id: 'steam_engine',
      title: 'Steam engine',
      caption:
        'Fire boils water into steam. The pressure of the steam pushes a piston back and forth, and a connecting rod and crank turn that into the rotation of the flywheel.',
      load: () => import('./PhysicsSteamEngine.jsx'),
      camera: [7, 4.2, 8.2],
      target: [0, 1.1, 0],
      fov: 40,
      sliders: [
        s('Piston_Speed', 'Engine speed', 0, 300, 10, 60, 'rpm'),
        s('Boiler_Pressure', 'Boiler pressure', 1, 18, 1, 10, 'bar'),
        s('Boiler_Temp', 'Boiler temperature', 100, 320, 10, 200, '°C'),
      ],
    },
  },
  {
    test: /\brockets?\b/,
    entry: {
      id: 'rocket',
      title: 'Rocket',
      caption:
        'A rocket moves forward by throwing exhaust gas backward (Newton’s third law). The larger the share of its starting mass that is fuel, the more speed it can gain: Δv = vₑ · ln(m₀ / m₁).',
      load: () => import('./PhysicsRocket.jsx'),
      camera: [0, 2.2, 8.5],
      target: [0, 1, 0],
      fov: 50,
      sliders: [
        s('Launch_Angle', 'Launch angle', 15, 85, 1, 45, '°'),
        s('Initial_Speed', 'Launch speed', 5, 150, 5, 30, 'm/s'),
        s('Mass_Ratio', 'Mass ratio m₀/m₁', 2, 50, 1, 20, ''),
      ],
    },
  },
  {
    test: /newton'?s?[\s-]?cradle/,
    entry: {
      id: 'newton_cradle',
      title: 'Newton’s cradle',
      caption:
        'When one ball strikes the row, its momentum and energy pass through the middle balls and one ball swings out on the far side. Lift two and two swing out: both momentum and kinetic energy are conserved.',
      load: () => import('./PhysicsNewtonsCradle.jsx'),
      camera: [1.6, 0.7, 5.2],
      target: [0, -0.1, 0],
      fov: 45,
      sliders: [
        s('Ball_Count', 'Balls', 2, 7, 1, 5, ''),
        s('Balls_Up', 'Balls lifted', 1, 4, 1, 1, ''),
        s('String_Length', 'String length', 0.5, 3, 0.1, 1.5, 'm'),
      ],
      remountOn: ['Ball_Count', 'Balls_Up', 'String_Length'],
    },
  },
  {
    test: /invert(ed)?[\s-]?pendulum|cart[\s-]?(and[\s-]|-)?pole/,
    entry: {
      id: 'inverted_pendulum',
      title: 'Inverted pendulum',
      caption:
        'A pole balanced upright on a cart is unstable: any small lean grows by itself. It stays up only if the cart keeps moving under it, the way you balance a broom on your hand.',
      load: () => import('./PhysicsInvertedPendulum.jsx'),
      camera: [2.2, 1.4, 4.2],
      target: [0, 0.55, 0],
      fov: 42,
      sliders: [
        s('Pole_Length', 'Pole length', 0.3, 1.15, 0.05, 0.55, 'm'),
        s('Pole_Angle', 'Starting lean', 2, 50, 1, 12, '°'),
        s('Cart_Position', 'Cart position', -1.5, 1.5, 0.1, 0, 'm'),
      ],
      remountOn: ['Pole_Length', 'Cart_Position'],
    },
  },
  {
    test: /\bpendulums?\b/,
    entry: {
      id: 'pendulum',
      title: 'Pendulum',
      caption:
        'For small swings, the time for one swing depends only on the length of the pendulum and on gravity: T = 2π√(L / g). A heavier bob does not swing faster or slower.',
      load: () => import('./PhysicsPendulum.jsx'),
      camera: [1.5, 2.6, 8.5],
      target: [0, 2.3, 0],
      fov: 45,
      sliders: [
        s('Length', 'Length', 1, 4, 0.1, 3, 'm'),
        s('Gravity', 'Gravity', 1.6, 25, 0.1, 9.8, 'm/s²'),
        s('Mass', 'Mass of the bob', 0.5, 20, 0.5, 2, 'kg'),
      ],
    },
  },
  {
    test: /\bsprings?\b|\bhooke'?s law\b|\bsimple harmonic\b/,
    not: /leaf spring|spring (season|break|tide)/,
    entry: {
      id: 'spring_mass',
      title: 'Mass on a spring',
      caption:
        'A mass on a spring bounces at a frequency set by the stiffness k and the mass m: f = (1 / 2π)√(k / m). A stiffer spring bounces faster and a heavier mass slower; damping makes the bounce die away.',
      load: () => import('./PhysicsSpringMass.jsx'),
      camera: [4.5, 3, 9.5],
      target: [0, 2.3, 0],
      fov: 40,
      sliders: [
        s('Spring_Stiffness', 'Stiffness k', 10, 1000, 10, 100, 'N/m'),
        s('Mass', 'Mass m', 0.5, 20, 0.5, 2, 'kg'),
        s('Damping', 'Damping', 0, 10, 0.1, 0.5, 'N·s/m'),
      ],
    },
  },
  {
    test: /\bprojectiles?\b|\bcannon[\s-]?balls?\b/,
    entry: {
      id: 'projectile',
      title: 'Projectile motion',
      caption:
        'With no air resistance the ball moves sideways at a constant speed while gravity pulls it down, so its path is a parabola. For a given launch speed, 45° gives the longest range.',
      load: () => import('./PhysicsProjectile.jsx'),
      camera: [0, 3, 11.5],
      target: [0, 1.6, 0],
      fov: 50,
      sliders: [
        s('Launch_Angle', 'Launch angle', 5, 85, 1, 45, '°'),
        s('Initial_Speed', 'Launch speed', 10, 36, 1, 30, 'm/s'),
        s('Gravity', 'Gravity', 6, 25, 0.1, 9.8, 'm/s²'),
      ],
    },
  },
  {
    test: /\borbit(s|al|ing)?\b|\bsatellites?\b|\bplanets?\b|\bplanetary motion\b|\bkepler/,
    entry: {
      id: 'orbit',
      title: 'Orbit',
      caption:
        'Gravity pulls the planet toward the star and keeps bending its path into an orbit. A heavier star or a smaller orbit means a shorter trip around (Kepler’s third law: T² ∝ r³ / M).',
      load: () => import('./PhysicsOrbit.jsx'),
      camera: [0, 10, 10],
      target: [0, 0, 0],
      fov: 45,
      sliders: [
        s('Star_Mass', 'Mass of the star', 1, 100, 1, 20, '× Sun'),
        s('Orbital_Radius', 'Orbit radius', 1, 8, 0.1, 4, 'AU'),
        s('Orbital_Speed', 'Speed', 0.1, 5, 0.1, 1, '×'),
      ],
    },
  },
  {
    test: /\bbridges?\b/,
    // the electrical ones are circuits, not structures
    // the hand-built model is a beam bridge: other kinds of bridge get a generated model with the right parts
    not: /wheatstone|rectifier|\bh[\s-]?bridge|bridge circuit|diode bridge|salt bridge|hydrogen bridge|suspension|cable|arch|truss|cantilever/,
    entry: {
      id: 'bridge',
      title: 'Beam bridge under load',
      caption:
        'A load in the middle bends the deck: the top is squeezed and the bottom is stretched. The bending stress grows with the load and the span, and falls fast as the deck gets thicker: σ = 3PL / (2bh²).',
      load: () => import('./PhysicsBridge.jsx'),
      camera: [4.4, 2.9, 10],
      target: [0, -0.2, 0],
      fov: 40,
      sliders: [
        s('Load', 'Load P', 0, 600, 10, 100, 'kN'),
        s('Deck_Thickness', 'Deck thickness h', 0.1, 1, 0.05, 0.5, 'm'),
        s('Span', 'Span L', 15, 50, 5, 40, 'm'),
      ],
    },
  },
]

export const ASSETS: AssetEntry[] = RULES.map((r) => r.entry)

export function assetById(id: string): AssetEntry | null {
  return ASSETS.find((a) => a.id === id) ?? null
}

/**
 * The hand-built model for this subject, or null. Only called for model3d figures (the tutor already
 * decided a 3D model is the right picture), so plain keyword rules are enough.
 */
export function matchAsset(subjectAndTitle: string): AssetEntry | null {
  const text = String(subjectAndTitle ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  for (const rule of RULES) {
    if (rule.test.test(text) && !(rule.not && rule.not.test(text))) return rule.entry
  }
  return null
}

/** The asset's defaults with the stored values on top; unknown keys and non-numbers are dropped, values clamped. */
export function assetParams(entry: AssetEntry, stored?: Record<string, unknown> | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const sl of entry.sliders) {
    const v = stored?.[sl.key]
    out[sl.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(sl.max, Math.max(sl.min, v)) : sl.def
  }
  return out
}
