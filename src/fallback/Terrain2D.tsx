import { useMemo } from 'react'
import type { TerrainNote, TerrainPeak } from '../domain/types'
import { buildContourPaths, sampleHeight } from '../pipeline/terrain'

interface Terrain2DProps {
  values: Float32Array
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  selectedNoteId: string | null
  onSelectNote: (id: string | null) => void
}

export function Terrain2D({
  values,
  gridSize,
  notes,
  peaks,
  selectedNoteId,
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
                fill={selected ? '#fff2bd' : height > 0.55 ? '#c6bfa7' : '#888883'}
                opacity={selected ? 1 : 0.36 + height * 0.4}
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
        <g className="terrain-peak-labels" aria-hidden="true">
          {peaks.slice(0, 18).map((peak) => (
            <text key={peak.id} x={peak.x * 2.8} y={-peak.y * 2.8 - 0.14}>
              {peak.label}
            </text>
          ))}
        </g>
      </svg>
      <div className="terrain-2d-badge">2D CONTOUR FALLBACK</div>
    </div>
  )
}
