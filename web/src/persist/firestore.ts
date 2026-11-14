import type { PageState } from '../contract'

// Firebase web config is public by design (access is controlled by firestore.rules).
// Set these in web/.env.local (dev) or web/.env.production (deploy). Missing = Firestore off.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firestoreEnabled = Boolean(config.apiKey && config.projectId)

export interface SavedPage {
  snapshot: string // JSON of the tldraw document snapshot (see pack.ts)
  state: PageState
  updated_at: number
}

let db: Promise<import('firebase/firestore').Firestore> | null = null

function getDb() {
  db ??= (async () => {
    const [{ initializeApp }, { getFirestore }] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
    return getFirestore(initializeApp(config))
  })()
  return db
}

/** pages/{page_id}, or null if it doesn't exist (or Firestore is off). */
export async function loadPage(pageId: string): Promise<SavedPage | null> {
  if (!firestoreEnabled) return null
  const [{ doc, getDoc }, firestore] = await Promise.all([import('firebase/firestore'), getDb()])
  const snap = await getDoc(doc(firestore, 'pages', pageId))
  return snap.exists() ? (snap.data() as SavedPage) : null
}

export async function savePage(pageId: string, page: SavedPage): Promise<void> {
  if (!firestoreEnabled) return
  const [{ doc, setDoc }, firestore] = await Promise.all([import('firebase/firestore'), getDb()])
  await setDoc(doc(firestore, 'pages', pageId), page)
}
