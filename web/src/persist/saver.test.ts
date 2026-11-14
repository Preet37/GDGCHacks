import { describe, expect, it } from 'vitest'
import { pageIdFromUrl } from './saver'

describe('pageIdFromUrl', () => {
  it('reads ?page=', () => {
    expect(pageIdFromUrl('?page=abc&dev')).toBe('abc')
    expect(pageIdFromUrl('?dev')).toBeNull()
  })
})
