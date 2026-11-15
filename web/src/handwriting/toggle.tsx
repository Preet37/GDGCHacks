import { useSyncExternalStore } from 'react'
import type { Editor } from 'tldraw'
import { HANDWRITING_EVENT, handwritingEnabled, setHandwritingEnabled } from './enabled'

function subscribe(onChange: () => void) {
  window.addEventListener(HANDWRITING_EVENT, onChange)
  return () => window.removeEventListener(HANDWRITING_EVENT, onChange)
}

/**
 * The chip that switches handwriting on and off (same look as "Show what AI read").
 * With an `editor`, switching it on starts learning from what is already on the page.
 */
export function HandwritingToggle({ editor }: { editor?: Editor | null }) {
  const on = useSyncExternalStore(subscribe, handwritingEnabled, () => false)
  const toggle = () => {
    setHandwritingEnabled(!on)
    // loaded on demand so the chip itself stays tiny
    if (!on && editor) void import('./harvest').then((m) => m.harvestGlyphs(editor)).catch(() => {})
  }
  return (
    <button className={'tutor-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={toggle}>
      Write in my handwriting
    </button>
  )
}
