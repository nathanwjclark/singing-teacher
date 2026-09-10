/** Private browser review copies. Capture/DSP exports remain the source of truth. */
export interface SavedProbeReview { hash: string; importedAt: string; filename: string; report: unknown }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('singing-teacher-probe-review', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'hash' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readProbeReviews(): Promise<SavedProbeReview[]> {
  const db = await database()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly')
    const request = tx.objectStore('reports').getAll()
    request.onsuccess = () => resolve(request.result as SavedProbeReview[])
    request.onerror = () => reject(request.error)
  }) } finally { db.close() }
}
export async function saveProbeReview(report: unknown, bytes: ArrayBuffer, filename: string): Promise<SavedProbeReview> {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  const db = await database()
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite'), store = tx.objectStore('reports')
    let saved: SavedProbeReview
    const request = store.get(hash)
    request.onsuccess = () => {
      saved = request.result ?? { hash, importedAt: new Date().toISOString(), filename, report }
      if (!request.result) store.add(saved)
    }
    tx.oncomplete = () => resolve(saved)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Could not retain report'))
  }) } finally { db.close() }
}
export async function deleteProbeReview(hash: string): Promise<void> {
  const db = await database()
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite')
    tx.objectStore('reports').delete(hash)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }) } finally { db.close() }
}
