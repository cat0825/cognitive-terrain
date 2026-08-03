import type { ProjectSummary, TerrainProject } from '../domain/types'
import { getDatabase } from './db'

export async function saveProject(project: TerrainProject): Promise<void> {
  const database = await getDatabase()
  await database.put('projects', project)
}

export async function getProject(id: string): Promise<TerrainProject | undefined> {
  const database = await getDatabase()
  return database.get('projects', id)
}

export async function deleteProject(id: string): Promise<void> {
  const database = await getDatabase()
  await database.delete('projects', id)
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const database = await getDatabase()
  const projects = await database.getAllFromIndex('projects', 'by-updated-at')
  return projects
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      noteCount: project.notes.length,
    }))
}
