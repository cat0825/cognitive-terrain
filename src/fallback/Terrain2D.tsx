import { useMemo } from 'react'
import type { TerrainNote, TerrainPeak, VisualDimension } from '../domain/types'
import { temperatureColor, type NoteActivitySummary } from '../domain/activity-temperature'
import { buildPlateCollisions, plateColor, primaryAreaForNote } from '../domain/knowledge-plates'
import { linkedNotes } from '../domain/knowledge-maintenance'
import { buildContourPaths, sampleHeight } from '../pipeline/terrain'
import { useAppStore } from '../store/app-store'

interface Terrain2DProps {
  values: Float32Array
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  selectedNoteId: string | null
  visualDimension: VisualDimension
  activityByNote: ReadonlyMap<string, NoteActivitySummary>
  onSelectNote: (id: string | null) => void
}

export function Terrain2D({
  values,
  gridSize,
  notes,
  peaks,
  selectedNoteId,
  visualDimension,
  activityByNote,
  onSelectNote,
}: Terrain2DProps) {
  const contours = useMemo(() => buildContourPaths(values, gridSize, 14), [gridSize, values])
  const paths = useMemo(
    () =>
      contours.flatMap((contour, contourIndex) =>
        contour.rings.slice(0, 14).map((ring, ringIndex) => ({
          id: `${contourIndex}-${ringIndex}`,
          value: contour.value,
          d: ring
            .map(([x, y], index) => {
              const px = (x / (gridSize - 1)) * 5.6 - 2.8
              const py = 2.8 - (y / (gridSize - 1)) * 5.6
              return `${index === 0 ? 'M' : 'L'} ${px.toFixed(3)} ${py.toFixed(3)}`
            })
            .join(' ') + ' Z',
        })),
      ),
    [contours, gridSize],
  )
  const selected = notes.find((note) => note.id === selectedNoteId)
  const relations = selected ? linkedNotes(notes, selected.id) : []
  const collisions = useMemo(() => buildPlateCollisions(notes), [notes])
  const sparseBridges = collisions.filter((collision) => collision.mode === 'lines').flatMap((collision) => collision.bridges)
  const collisionBands = collisions.filter((collision) => collision.mode === 'band')
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const activeCollisionId = useAppStore((state) => state.activeCollisionId)
  const selectCollision = useAppStore((state) => state.selectCollision)
  const activePeakId = useAppStore((state) => state.activePeakId)
  const setActivePeak = useAppStore((state) => state.setActivePeak)

  return (
    <div className="terrain-2d" onClick={() => onSelectNote(null)}>
      <svg viewBox="-3.15 -3.15 6.3 6.3" role="img" aria-label="认知地形二维等高线图">
        <defs>
          <radialGradient id="terrain-glow" cx="50%" cy="45%" r="68%">
            <stop offset="0%" stopColor="#1b1b1a" />
            <stop offset="66%" stopColor="#161616" />
            <stop offset="100%" stopColor="#121212" />
          </radialGradient>
          <filter id="selected-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="0.06" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="plate-collision-direction-arrow"
            markerUnits="userSpaceOnUse"
            markerWidth="0.14"
            markerHeight="0.11"
            viewBox="0 -0.055 0.14 0.11"
            refX="0.125"
            refY="0"
            orient="auto"
          >
            <path d="M 0 -0.055 L 0.14 0 L 0 0.055 Z" fill="#fff0a8" />
          </marker>
        </defs>
        <rect x="-3.15" y="-3.15" width="6.3" height="6.3" fill="url(#terrain-glow)" />
        <g className="contour-grid">
          {Array.from({ length: 13 }, (_, index) => {
            const position = -3 + index * 0.5
            return (
              <g key={position}>
                <line x1={position} y1="-3.15" x2={position} y2="3.15" />
                <line x1="-3.15" y1={position} x2="3.15" y2={position} />
              </g>
            )
          })}
        </g>
        <g className="contour-lines">
          {paths.map((path) => (
            <path
              key={path.id}
              d={path.d}
              opacity={0.16 + path.value * 0.42}
              stroke={path.value > 0.62 ? '#b9b4a3' : path.value > 0.34 ? '#85857f' : '#4b4b49'}
            />
          ))}
        </g>
        {visualDimension === 'area' && sparseBridges.length > 0 && (
          <g className="plate-bridge-lines" aria-hidden="true">
            {sparseBridges.map((bridge) => {
              const from = notesById.get(bridge.fromId)
              const to = notesById.get(bridge.toId)
              if (!from || !to) return null
              return <line
                key={bridge.id}
                className={`plate-bridge plate-bridge--${bridge.kind}`}
                x1={from.x * 2.8}
                y1={-from.y * 2.8}
                x2={to.x * 2.8}
                y2={-to.y * 2.8}
                opacity={0.32 + bridge.score * 0.5}
              />
            })}
          </g>
        )}
        {visualDimension === 'area' && collisionBands.length > 0 && (
          <g className="plate-collision-bands">
            {collisionBands.map((collision) => {
              const directed = collision.direction !== 'neutral'
              const points = collision.direction === 'second-to-first'
                ? { from: collision.secondAnchor, to: collision.firstAnchor }
                : { from: collision.firstAnchor, to: collision.secondAnchor }
              const description = collisionDirectionDescription(collision)
              return (
                <line
                  key={collision.id}
                  className={collision.id === activeCollisionId ? 'plate-collision-band is-active' : 'plate-collision-band'}
                  x1={points.from.x * 2.8}
                  y1={-points.from.y * 2.8}
                  x2={points.to.x * 2.8}
                  y2={-points.to.y * 2.8}
                  strokeWidth={0.014 + collision.strength * 0.045}
                  markerEnd={directed ? 'url(#plate-collision-direction-arrow)' : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={description}
                  onClick={(event) => {
                    event.stopPropagation()
                    selectCollision(collision.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') selectCollision(collision.id)
                  }}
                >
                  <title>{description}</title>
                </line>
              )
            })}
          </g>
        )}
        {selected && relations.length > 0 && <g className="explicit-relation-lines" aria-hidden="true">{relations.map((target) => <line key={target.id} x1={selected.x * 2.8} y1={-selected.y * 2.8} x2={target.x * 2.8} y2={-target.y * 2.8} stroke="#9b8ad9" strokeWidth="0.012" opacity="0.7" />)}</g>}
        <g className="terrain-points">
          {notes.map((note) => {
            const selected = note.id === selectedNoteId
            const height = sampleHeight(values, gridSize, note.x, note.y)
            return (
              <circle
                key={note.id}
                cx={note.x * 2.8}
                cy={-note.y * 2.8}
                r={selected ? 0.07 : 0.024 + height * 0.022}
                fill={selected ? '#fff2bd' : noteColor(note, height, visualDimension, activityByNote)}
                opacity={selected ? 1 : noteOpacity(note, height, visualDimension, activityByNote)}
                filter={selected ? 'url(#selected-glow)' : undefined}
                role="button"
                aria-label={note.title}
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectNote(note.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNote(note.id)
                }}
              />
            )
          })}
        </g>
        <g className="terrain-peak-labels" aria-label="主题峰值">
          {peaks.slice(0, 18).map((peak) => (
            <text
              key={peak.id}
              x={peak.x * 2.8}
              y={-peak.y * 2.8 - 0.14}
              role="button"
              tabIndex={0}
              aria-pressed={activePeakId === peak.id}
              aria-label={`峰值 ${peak.label}，${peak.noteIds.length} 条成员笔记`}
              onClick={(event) => {
                event.stopPropagation()
                setActivePeak(activePeakId === peak.id ? null : peak)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setActivePeak(activePeakId === peak.id ? null : peak)
              }}
            >
              {peak.label}
            </text>
          ))}
        </g>
      </svg>
      <div className="terrain-2d-badge">2D CONTOUR FALLBACK</div>
    </div>
  )
}

function collisionDirectionDescription(collision: {
  firstArea: string
  secondArea: string
  relationCount: number
  firstToSecondCount: number
  secondToFirstCount: number
  bidirectionalCount: number
  direction: 'first-to-second' | 'second-to-first' | 'neutral'
}): string {
  const evidence = `${collision.relationCount} 条跨域 WikiLink；${collision.firstToSecondCount} 条 ${collision.firstArea}→${collision.secondArea}，${collision.secondToFirstCount} 条 ${collision.secondArea}→${collision.firstArea}，${collision.bidirectionalCount} 对双向关系`
  if (collision.direction === 'first-to-second') return `碰撞带，${collision.firstArea} 指向 ${collision.secondArea}；${evidence}`
  if (collision.direction === 'second-to-first') return `碰撞带，${collision.secondArea} 指向 ${collision.firstArea}；${evidence}`
  return `碰撞带，${collision.firstArea} 与 ${collision.secondArea} 无稳定方向；${evidence}`
}

function noteColor(
  note: TerrainNote,
  height: number,
  dimension: VisualDimension,
  activityByNote: ReadonlyMap<string, NoteActivitySummary>,
): string {
  if (dimension === 'temperature') return temperatureColor(activityByNote.get(note.id)?.score ?? 0)
  if (dimension === 'mastery' || dimension === 'exploration' || dimension === 'activity' || dimension === 'area') {
    const area = primaryAreaForNote(note)
    return area ? plateColor(area) : '#767673'
  }
  return height > 0.55 ? '#c6bfa7' : '#888883'
}

function noteOpacity(
  note: TerrainNote,
  height: number,
  dimension: VisualDimension,
  activityByNote: ReadonlyMap<string, NoteActivitySummary>,
): number {
  if (dimension === 'temperature') return 0.32 + (activityByNote.get(note.id)?.score ?? 0) * 0.68
  return 0.36 + height * 0.4
}
