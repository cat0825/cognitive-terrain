import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, DataTexture, DoubleSide, ShaderMaterial, UniformsLib, UniformsUtils, Vector2 } from 'three'
import type { QualityLevel } from '../domain/types'
import { getLiveTimeline } from '../store/app-store'
import { TERRAIN_DEPTH, TERRAIN_WIDTH } from './terrain-config'
import { TERRAIN_VISUAL_PROFILE } from './terrain-visual-profile'

interface TerrainMistProps {
  heightTexture: DataTexture
  heightAtlasSize: Vector2
  atlasColumns: number
  heightGridSize: number
  heightFrameCount: number
  quality: QualityLevel
  reducedMotion: boolean
}

const HEIGHT_SAMPLE = `
  uniform sampler2D uHeightAtlas;
  uniform vec2 uHeightAtlasSize;
  uniform float uAtlasColumns;
  uniform float uHeightGridSize;
  uniform float uHeightFrameCount;
  uniform float uTimeline;

  float sampleHeightFrame(vec2 normalizedPosition, float frameIndex) {
    float safeFrame = clamp(frameIndex, 0.0, uHeightFrameCount - 1.0);
    vec2 tile = vec2(mod(safeFrame, uAtlasColumns), floor(safeFrame / uAtlasColumns));
    vec2 gridPixel = clamp(normalizedPosition, 0.0, 1.0) * (uHeightGridSize - 1.0);
    vec2 atlasPixel = tile * uHeightGridSize + gridPixel + vec2(0.5);
    return texture2D(uHeightAtlas, atlasPixel / uHeightAtlasSize).r;
  }

  float sampleTimelineHeight(vec2 normalizedPosition) {
    float safeTimeline = clamp(uTimeline, 0.0, uHeightFrameCount - 1.0);
    float frameA = floor(safeTimeline);
    float frameB = min(uHeightFrameCount - 1.0, frameA + 1.0);
    return mix(
      sampleHeightFrame(normalizedPosition, frameA),
      sampleHeightFrame(normalizedPosition, frameB),
      fract(safeTimeline)
    );
  }
`

export function TerrainMist({
  heightTexture,
  heightAtlasSize,
  atlasColumns,
  heightGridSize,
  heightFrameCount,
  quality,
  reducedMotion,
}: TerrainMistProps) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uHeightAtlas: { value: heightTexture },
            uHeightAtlasSize: { value: heightAtlasSize },
            uAtlasColumns: { value: atlasColumns },
            uHeightGridSize: { value: heightGridSize },
            uHeightFrameCount: { value: heightFrameCount },
            uTimeline: { value: getLiveTimeline() },
            uTime: { value: 0 },
            uOpacity: { value: TERRAIN_VISUAL_PROFILE.mist.opacity[quality] },
            uColor: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.mist) },
          },
        ]),
        vertexShader: `
          #include <common>
          #include <fog_pars_vertex>
          varying vec2 vTerrainPosition;
          ${HEIGHT_SAMPLE}

          void main() {
            vTerrainPosition = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: `
          #include <common>
          #include <fog_pars_fragment>
          uniform float uTime;
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec2 vTerrainPosition;
          ${HEIGHT_SAMPLE}

          float hash21(vec2 point) {
            point = fract(point * vec2(123.34, 456.21));
            point += dot(point, point + 45.32);
            return fract(point.x * point.y);
          }

          float mistNoise(vec2 point) {
            vec2 cell = floor(point);
            vec2 local = smoothstep(0.0, 1.0, fract(point));
            float a = hash21(cell);
            float b = hash21(cell + vec2(1.0, 0.0));
            float c = hash21(cell + vec2(0.0, 1.0));
            float d = hash21(cell + vec2(1.0, 1.0));
            return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
          }

          void main() {
            float terrainHeight = sampleTimelineHeight(vTerrainPosition);
            float valley = 1.0 - smoothstep(0.08, 0.36, terrainHeight);
            float noise = mistNoise(vTerrainPosition * vec2(7.0, 11.0) + vec2(uTime * 0.015, -uTime * 0.009));
            float mistPatch = smoothstep(0.38, 0.78, noise);
            float edge = smoothstep(0.02, 0.14, vTerrainPosition.x)
              * smoothstep(0.02, 0.14, 1.0 - vTerrainPosition.x)
              * smoothstep(0.01, 0.16, vTerrainPosition.y)
              * smoothstep(0.01, 0.18, 1.0 - vTerrainPosition.y);
            float alpha = uOpacity * valley * mistPatch * edge;
            if (alpha < 0.006) discard;
            gl_FragColor = vec4(uColor, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }
        `,
      }),
    [
      atlasColumns,
      heightAtlasSize,
      heightFrameCount,
      heightGridSize,
      heightTexture,
      quality,
    ],
  )

  useFrame(({ clock }) => {
    material.uniforms.uTimeline.value = getLiveTimeline()
    material.uniforms.uTime.value = reducedMotion ? 0 : (clock.elapsedTime % TERRAIN_VISUAL_PROFILE.mist.period)
  })

  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, TERRAIN_VISUAL_PROFILE.mist.altitude, 0]}
      material={material}
    >
      <planeGeometry args={[TERRAIN_WIDTH, TERRAIN_DEPTH, 1, 1]} />
    </mesh>
  )
}
