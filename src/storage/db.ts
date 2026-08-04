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
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore('projects', { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
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
  if (project.schemaVersion >= 2) return project
  return {
    ...project,
    schemaVersion: 2,
    embeddingMode: 'fallback',
    noteNeighbors: [],
  }
}
