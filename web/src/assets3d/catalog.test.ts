import { describe, expect, it } from 'vitest'
import { ASSETS, assetById, assetParams, matchAsset } from './catalog'

const id = (text: string) => matchAsset(text)?.id ?? null

describe('matchAsset', () => {
  it('finds the hand-built model for a subject', () => {
    expect(id('the physics of a bridge')).toBe('bridge')
    expect(id('beam bridge under a load')).toBe('bridge')
    expect(matchAsset('suspension bridge Suspension Bridge Physics')).toBeNull()
    expect(matchAsset('truss bridge')).toBeNull()
    expect(id('formula one car')).toBe('f1_car')
    expect(id('Formula 1 car aerodynamics')).toBe('f1_car')
    expect(id('F1 car')).toBe('f1_car')
    expect(id('a race car')).toBe('f1_car')
    expect(id('wind turbine')).toBe('wind_turbine')
    expect(id('Windmill')).toBe('wind_turbine')
    expect(id('helicopter rotor')).toBe('helicopter')
    expect(id('rocket launch')).toBe('rocket')
    expect(id('steam engine')).toBe('steam_engine')
    expect(id("Newton's cradle")).toBe('newton_cradle')
    expect(id('Newton’s Cradle')).toBe('newton_cradle')
    expect(id('newtons cradle')).toBe('newton_cradle')
    expect(id('simple pendulum')).toBe('pendulum')
    expect(id('mass on a spring')).toBe('spring_mass')
    expect(id('projectile motion')).toBe('projectile')
    expect(id('a satellite in orbit')).toBe('orbit')
    expect(id('planet around a star')).toBe('orbit')
  })

  it('the more specific subject wins', () => {
    expect(id('inverted pendulum on a cart')).toBe('inverted_pendulum')
    expect(id("Newton's cradle pendulum")).toBe('newton_cradle')
    expect(id('steam engine gears')).toBe('steam_engine')
    expect(id('rocket reaching orbit')).toBe('rocket')
    expect(id('wind turbine gearbox')).toBe('wind_turbine')
  })

  it('leaves everything else to the built model', () => {
    expect(matchAsset('')).toBeNull()
    expect(matchAsset('a hydraulic press')).toBeNull()
    expect(matchAsset('crane')).toBeNull()
    // left out of the library (the sandbox models of these are not good enough to show)
    expect(matchAsset('a bicycle')).toBeNull()
    expect(matchAsset('submarine')).toBeNull()
    expect(matchAsset('gear train')).toBeNull()
    expect(matchAsset('planetary gear set')).toBeNull()
    expect(matchAsset('roof truss')).toBeNull()
    expect(matchAsset('motorbike engine')).toBeNull()
    expect(matchAsset('Wheatstone bridge')).toBeNull()
    expect(matchAsset('H-bridge motor driver')).toBeNull()
    expect(matchAsset('bridge rectifier')).toBeNull()
    expect(matchAsset('aircraft landing gear')).toBeNull()
    expect(matchAsset('offspring')).toBeNull()
    expect(matchAsset('rocketry club')).toBeNull()
  })
})

describe('the catalogue', () => {
  it('every asset has an id, a caption, a loader and sane sliders', () => {
    const ids = new Set<string>()
    for (const a of ASSETS) {
      expect(ids.has(a.id)).toBe(false)
      ids.add(a.id)
      expect(assetById(a.id)).toBe(a)
      expect(a.caption.length).toBeGreaterThan(40)
      expect(typeof a.load).toBe('function')
      expect(a.sliders.length).toBeGreaterThan(0)
      expect(a.sliders.length).toBeLessThanOrEqual(3)
      for (const sl of a.sliders) {
        expect(sl.min).toBeLessThan(sl.max)
        expect(sl.step).toBeGreaterThan(0)
        expect(sl.def).toBeGreaterThanOrEqual(sl.min)
        expect(sl.def).toBeLessThanOrEqual(sl.max)
      }
      for (const k of a.remountOn ?? []) expect(a.sliders.some((sl) => sl.key === k)).toBe(true)
    }
    expect(assetById('nope')).toBeNull()
  })

  it('assetParams: defaults, with stored numbers clamped on top', () => {
    const bridge = assetById('bridge')!
    expect(assetParams(bridge)).toEqual({ Load: 100, Deck_Thickness: 0.5, Span: 40 })
    expect(assetParams(bridge, { Load: 9999, Span: 'x', Other: 3 })).toEqual({ Load: 600, Deck_Thickness: 0.5, Span: 40 })
  })
})
