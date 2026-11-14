import type { Editor } from 'tldraw'
import type { Tutor } from '../sync/tutor'
import { loadPage, savePage } from './firestore'
import { packSnapshot } from './pack'

export const SAVE_DEBOUNCE_MS = 3000

/** The page to open: ?page=<id> wins (open the same notebook on another device), else this device's last page. */
export function pageIdFromUrl(search = location.search): string | null {
  return new URLSearchParams(search).get('page')
}

/** Load pages/{page_id} into the editor + tutor, if it exists. Returns true if something was loaded. */
export async function restorePage(editor: Editor, tutor: Tutor): Promise<boolean> {
  const saved = await loadPage(tutor.state.page_id)
  if (!saved) return false
  editor.loadSnapshot({ document: JSON.parse(saved.snapshot) })
  tutor.adoptState(saved.state)
  return true
}

/** Saves the page (tldraw document + PageState) a few seconds after changes and after every reply. */
export function startAutosave(editor: Editor, tutor: Tutor, onError: (msg: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving = false
  let again = false

  const save = async () => {
    timer = null
    if (saving) {
      again = true
      return
    }
    saving = true
    try {
      const { json } = packSnapshot(editor.getSnapshot().document)
      await savePage(tutor.state.page_id, { snapshot: json, state: tutor.state, updated_at: Date.now() })
    } catch (err) {
      console.warn('save failed', err)
      onError("Couldn't save to the cloud (still saved on this device)")
    } finally {
      saving = false
      if (again) {
        again = false
        schedule()
      }
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
  }

  const offStore = editor.store.listen(schedule, { scope: 'document' })
  const offTutor = tutor.on((e) => e.type === 'reply' && schedule())
  return () => {
    offStore()
    offTutor()
    if (timer) clearTimeout(timer)
  }
}
