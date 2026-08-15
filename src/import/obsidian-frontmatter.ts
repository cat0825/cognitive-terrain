import { z } from 'zod'
import type { NoteStatus } from '../domain/types'
import { areasForNote } from '../domain/knowledge-plates'

const scoreSchema = z.number().finite().min(0).max(1)
const statusSchema = z.enum(['seed', 'growing', 'stable', 'gap', 'archived'])
const areaSchema = z.string().trim().min(1)
const areaListSchema = z.array(areaSchema).min(1)
const reviewedAtSchema = z.string().trim().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: '必须是有效日期',
})

export interface ObsidianCognitiveFields {
  mastery?: number
  confidence?: number
  exploration?: number
  status?: NoteStatus
  area?: string
  areas?: string[]
  reviewedAt?: string
}

export interface ObsidianFrontmatterIssue {
  field: keyof ObsidianCognitiveFields
  message: string
}

export function parseObsidianCognitiveFields(frontmatter: Record<string, unknown>): {
  fields: ObsidianCognitiveFields
  issues: ObsidianFrontmatterIssue[]
} {
  const fields: ObsidianCognitiveFields = {}
  const issues: ObsidianFrontmatterIssue[] = []

  parseField(frontmatter, fields, issues, 'mastery', scoreSchema)
  parseField(frontmatter, fields, issues, 'confidence', scoreSchema)
  parseField(frontmatter, fields, issues, 'exploration', scoreSchema)
  parseField(frontmatter, fields, issues, 'status', statusSchema)
  parseAreaFields(frontmatter, fields, issues)
  parseField(frontmatter, fields, issues, 'reviewedAt', reviewedAtSchema, (value) => new Date(value).toISOString())

  return { fields, issues }
}

function parseAreaFields(
  source: Record<string, unknown>,
  target: ObsidianCognitiveFields,
  issues: ObsidianFrontmatterIssue[],
): void {
  const labels: string[] = []
  for (const field of ['area', 'areas'] as const) {
    if (!(field in source)) continue
    const result = z.union([areaSchema, areaListSchema]).safeParse(source[field])
    if (!result.success) {
      issues.push({ field, message: '必须是非空文本或非空文本数组' })
      continue
    }
    labels.push(...(typeof result.data === 'string' ? [result.data] : result.data))
  }
  const areas = areasForNote({ areas: labels })
  if (areas.length) {
    target.area = areas[0]
    target.areas = areas
  }
}

function parseField<K extends keyof ObsidianCognitiveFields, Output>(
  source: Record<string, unknown>,
  target: ObsidianCognitiveFields,
  issues: ObsidianFrontmatterIssue[],
  key: K,
  schema: z.ZodType<Output>,
  normalize?: (value: Output) => ObsidianCognitiveFields[K],
): void {
  if (!(key in source)) return
  const result = schema.safeParse(source[key])
  if (!result.success) {
    issues.push({ field: key, message: formatIssue(result.error.issues[0]?.message ?? '值无效') })
    return
  }
  target[key] = normalize ? normalize(result.data) : result.data as ObsidianCognitiveFields[K]
}

function formatIssue(message: string): string {
  if (message.includes('Too small') || message.includes('greater than or equal')) return '必须在 0 到 1 之间'
  if (message.includes('Too big') || message.includes('less than or equal')) return '必须在 0 到 1 之间'
  if (message.includes('Invalid option')) return '不是支持的状态'
  if (message.includes('expected number')) return '必须是 0 到 1 之间的数字'
  return message
}
