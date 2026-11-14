import { describe, expect, it } from 'vitest'
import firebase from '../../firebase.json'

describe('firebase.json', () => {
  const { hosting } = firebase

  it('serves the built web app', () => {
    expect(hosting.public).toBe('web/dist')
  })

  it('sends /api/** to Cloud Run tutor-api before the SPA fallback', () => {
    expect(hosting.rewrites[0]).toEqual({
      source: '/api/**',
      run: { serviceId: 'tutor-api', region: 'us-central1' },
    })
    expect(hosting.rewrites.at(-1)).toEqual({ source: '**', destination: '/index.html' })
  })
})
