import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('dev server config', () => {
  it('listens on the network so the iPad can open it', () => {
    expect(config.server?.host).toBe(true)
  })

  it('proxies /api to the local FastAPI server', () => {
    expect(config.server?.proxy?.['/api']).toBe('http://localhost:8000')
  })
})
