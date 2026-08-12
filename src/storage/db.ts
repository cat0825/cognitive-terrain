import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TerrainProject } from '../domain/types'

interface CognitiveTerrainDB extends DBSchema {
  projects: {
    key: string
    value: TerrainProject
    indexes: { 'by-updated-at': string }
  }
}

let databasePromise: Promise<IDBPDatabase<CognitiveTerrainDB>> | undefined

export function getDatabase(): Promise<IDBPDatabase<CognitiveTerrainDB>> {
  databasePromise ??= openDB<CognitiveTerrainDB>('cognitive-terrain', 2, {
    async upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const store = database.createObjectStore('projects', { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
      }
      if (oldVersion >= 1 && oldVersion < 2) {
        const store = transaction.objectStore('projects')
        let cursor = await store.openCursor()
        while (cursor) {
          await cursor.update(migrateProject(cursor.value))
          cursor = await cursor.continue()
        }
      }
    },
  })
  return databasePromise
}

export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return
  const database = await databasePromise
  database.close()
  databasePromise = undefined
}

export function migrateProject(project: TerrainProject): TerrainProject {
  const legacy = project.schemaVersion < 2
  return {
    ...project,
    schemaVersion: 2,
    embeddingMode: legacy ? 'fallback' : project.embeddingMode ?? 'fallback',
    noteNeighbors: legacy ? [] : project.noteNeighbors ?? [],
    notes: project.notes.map((note) => ({
      ...note,
      links: note.links ?? [],
    })),
  }
}
