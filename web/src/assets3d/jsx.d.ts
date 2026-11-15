// The hand-built models are plain .jsx (copied unchanged from LoominPhysicsSandbox); this is their type.
declare module '*.jsx' {
  import type { ComponentType } from 'react'
  const Model: ComponentType<{ params?: Record<string, number>; simConfig?: unknown }>
  export default Model
}
