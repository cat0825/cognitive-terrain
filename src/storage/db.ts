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
  databasePromise ??= openDB<CognitiveTerrainDB>('cognitive-terrain', 1, {
    upgrade(database) {
      const store = database.createObjectStore('projects', { keyPath: 'id' })
      store.createIndex('by-updated-at', 'updatedAt')
    },
  })
  return databasePromise
}
