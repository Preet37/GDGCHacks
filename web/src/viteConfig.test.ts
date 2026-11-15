import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('dev server config', () => {
  it('listens on the network so the iPad can open it', () => {
    expect(config.server?.host).toBe(true)
  })

  it('proxies /api to the local FastAPI server', () => {
    // API_TARGET can point it at a deployed server instead; unset, it is the local one.
    const api = config.server?.proxy?.['/api'] as { target: string; changeOrigin: boolean }
    expect(api.target).toBe(process.env.API_TARGET ?? 'http://localhost:8000')
    expect(api.changeOrigin).toBe(true)
  })
})
