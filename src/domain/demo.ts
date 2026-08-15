import type { TerrainNote, TerrainProject } from './types'
import { buildTerrainData } from '../pipeline/terrain'
import { computeNeighbors } from '../pipeline/neighbors'
import { cognitiveStateFromNote } from './cognitive-state'
import { DEFAULT_TERRAIN_PROFILE_ID, DEFAULT_TERRAIN_PROFILES } from './terrain-profile'

interface DemoTopic {
  key: string
  domain: string
  center: readonly [number, number]
  spread: readonly [number, number]
  angle: number
  prominence: number
  concepts: readonly [string, string, string, string, string]
}

const articlesPerTopic = 60
const articlesPerMonth = 36
const demoStart = new Date('2021-11-26T20:54:10+08:00')

const articleLenses = [
  '',
  '核心机制',
  '数据流',
  '内存开销',
  '计算路径',
  '通信边界',
  '调度策略',
  '性能瓶颈',
  '工程实现',
  '故障诊断',
  '选型对比',
  '规模化实践',
] as const

const topics: DemoTopic[] = [
  {
    key: '调度与资源管理',
    domain: '平台工程',
    center: [-0.088, -0.155],
    spread: [0.072, 0.045],
    angle: -0.2,
    prominence: 1.42,
    concepts: ['GPU 资源池化', '配额与优先级', '拓扑感知调度', '弹性伸缩', '多租户隔离'],
  },
  {
    key: 'GPU 架构',
    domain: '硬件与互联',
    center: [-0.78, 0.72],
    spread: [0.07, 0.045],
    angle: 0.22,
    prominence: 1.7,
    concepts: ['SM 与 Tensor Core', 'GPU 流水线', '线程束执行', '架构代际演进', '算力规格解读'],
  },
  {
    key: '内存与显存',
    domain: '硬件与互联',
    center: [-0.47, 0.78],
    spread: [0.058, 0.082],
    angle: -0.34,
    prominence: 0.88,
    concepts: ['存储层次', '显存带宽', '共享内存', 'Pinned Memory', '显存碎片'],
  },
  {
    key: '集群网络',
    domain: '硬件与互联',
    center: [-0.15, 0.74],
    spread: [0.09, 0.046],
    angle: 0.12,
    prominence: 1.34,
    concepts: ['NVLink 与 NVSwitch', 'InfiniBand', 'RoCE', 'Fat-Tree 拓扑', 'RDMA 数据路径'],
  },
  {
    key: 'NCCL 集合通信',
    domain: '硬件与互联',
    center: [0.18, 0.76],
    spread: [0.055, 0.078],
    angle: 0.28,
    prominence: 1.1,
    concepts: ['AllReduce', 'Ring 与 Tree', '通信拓扑发现', 'NCCL 调优', '集合通信故障'],
  },
  {
    key: 'CUDA 编程',
    domain: 'CUDA 与算子',
    center: [0.5, 0.72],
    spread: [0.085, 0.048],
    angle: -0.26,
    prominence: 1.58,
    concepts: ['Grid Block Thread', 'Warp 执行模型', '内存合并访问', '同步与原子操作', 'Occupancy'],
  },
  {
    key: '经典算子',
    domain: 'CUDA 与算子',
    center: [0.78, 0.63],
    spread: [0.052, 0.086],
    angle: -0.1,
    prominence: 0.8,
    concepts: ['GEMM Tiling', 'Reduce 归约', 'Online Softmax', '算子融合', '向量化访存'],
  },
  {
    key: 'FlashAttention',
    domain: 'CUDA 与算子',
    center: [-0.7, 0.49],
    spread: [0.088, 0.043],
    angle: 0.38,
    prominence: 1.46,
    concepts: ['IO Awareness', 'Tiling 与重计算', 'FlashAttention 2', 'FlashAttention 3', 'Decode Attention'],
  },
  {
    key: 'AI 编译器',
    domain: 'CUDA 与算子',
    center: [-0.39, 0.5],
    spread: [0.055, 0.08],
    angle: -0.42,
    prominence: 1.23,
    concepts: ['Triton Kernel', 'torch.compile', '计算图优化', '算子自动调优', 'TVM 与 XLA'],
  },
  {
    key: '性能分析',
    domain: 'CUDA 与算子',
    center: [-0.08, 0.54],
    spread: [0.094, 0.05],
    angle: 0.08,
    prominence: 0.72,
    concepts: ['Nsight Systems', 'Nsight Compute', 'Roofline 模型', 'PyTorch Profiler', 'Kernel 时间线'],
  },
  {
    key: 'PyTorch Runtime',
    domain: '训练系统',
    center: [0.23, 0.5],
    spread: [0.058, 0.075],
    angle: 0.3,
    prominence: 1.28,
    concepts: ['Autograd 引擎', 'CUDA Stream', '内存分配器', 'Dispatcher', '计算图捕获'],
  },
  {
    key: '优化器',
    domain: '训练系统',
    center: [0.51, 0.48],
    spread: [0.086, 0.046],
    angle: -0.32,
    prominence: 0.86,
    concepts: ['AdamW 状态', 'LAMB 与 LARS', '梯度裁剪', '学习率调度', '大 Batch 训练'],
  },
  {
    key: '数据并行',
    domain: '训练系统',
    center: [0.76, 0.39],
    spread: [0.052, 0.079],
    angle: 0.16,
    prominence: 1.08,
    concepts: ['DDP Reducer', '梯度同步', 'Bucket 划分', '通信计算重叠', '多机启动'],
  },
  {
    key: 'FSDP / ZeRO',
    domain: '训练系统',
    center: [-0.76, 0.23],
    spread: [0.082, 0.047],
    angle: -0.18,
    prominence: 1.6,
    concepts: ['参数分片', '梯度分片', '优化器状态分片', 'ZeRO Offload', 'FSDP Wrap'],
  },
  {
    key: '张量并行',
    domain: '训练系统',
    center: [-0.5, 0.25],
    spread: [0.052, 0.084],
    angle: 0.34,
    prominence: 1.14,
    concepts: ['列并行线性层', '行并行线性层', 'Attention 切分', '序列并行', '通信代价'],
  },
  {
    key: '流水线并行',
    domain: '训练系统',
    center: [-0.22, 0.29],
    spread: [0.093, 0.044],
    angle: 0.2,
    prominence: 0.82,
    concepts: ['GPipe', '1F1B 调度', '流水线气泡', '层划分', '激活传输'],
  },
  {
    key: '3D 并行',
    domain: '训练系统',
    center: [0.06, 0.29],
    spread: [0.06, 0.078],
    angle: -0.38,
    prominence: 1.36,
    concepts: ['DP TP PP 组合', '并行维度映射', '拓扑规划', '通信组构建', '扩展效率'],
  },
  {
    key: '混合精度',
    domain: '训练系统',
    center: [0.34, 0.26],
    spread: [0.083, 0.046],
    angle: -0.08,
    prominence: 0.96,
    concepts: ['FP16 与 BF16', 'Loss Scaling', 'FP8 训练', '主权重维护', '数值稳定性'],
  },
  {
    key: 'Checkpoint',
    domain: '训练系统',
    center: [0.61, 0.23],
    spread: [0.05, 0.08],
    angle: 0.42,
    prominence: 0.68,
    concepts: ['Activation Checkpoint', '分布式存档', '异步 Checkpoint', '断点续训', '状态重分片'],
  },
  {
    key: '推理引擎',
    domain: '推理系统',
    center: [0.79, 0.12],
    spread: [0.083, 0.044],
    angle: -0.24,
    prominence: 1.62,
    concepts: ['Prefill 与 Decode', 'Token 调度循环', '执行器架构', '模型加载', '服务化接口'],
  },
  {
    key: 'KV Cache',
    domain: '推理系统',
    center: [-0.68, -0.03],
    spread: [0.052, 0.086],
    angle: -0.14,
    prominence: 1.52,
    concepts: ['PagedAttention', 'Block Table', '缓存复用', 'Prefix Caching', 'KV 压缩'],
  },
  {
    key: 'Continuous Batching',
    domain: '推理系统',
    center: [-0.4, 0],
    spread: [0.087, 0.045],
    angle: 0.28,
    prominence: 1.16,
    concepts: ['迭代级调度', '请求抢占', '动态批处理', 'Chunked Prefill', '公平性策略'],
  },
  {
    key: '量化',
    domain: '推理系统',
    center: [-0.12, 0.04],
    spread: [0.057, 0.078],
    angle: -0.36,
    prominence: 0.98,
    concepts: ['INT8 量化', 'INT4 权重量化', 'GPTQ', 'AWQ', 'SmoothQuant'],
  },
  {
    key: 'Speculative Decoding',
    domain: '推理系统',
    center: [0.18, 0.03],
    spread: [0.09, 0.046],
    angle: 0.12,
    prominence: 1.25,
    concepts: ['Draft Model', '并行验证', '接受率', 'Tree Attention', '投机采样'],
  },
  {
    key: 'PD 解耦',
    domain: '推理系统',
    center: [0.46, 0],
    spread: [0.052, 0.082],
    angle: 0.4,
    prominence: 1.48,
    concepts: ['Prefill 集群', 'Decode 集群', 'KV 传输', '异构部署', '路由策略'],
  },
  {
    key: '推理框架',
    domain: '推理系统',
    center: [0.72, -0.08],
    spread: [0.09, 0.047],
    angle: -0.18,
    prominence: 0.91,
    concepts: ['vLLM', 'SGLang', 'TensorRT-LLM', 'TGI', '框架兼容层'],
  },
  {
    key: 'Kubernetes / GPU Operator',
    domain: '平台工程',
    center: [-0.64, -0.28],
    spread: [0.055, 0.082],
    angle: 0.26,
    prominence: 0.72,
    concepts: ['GPU Operator', 'Device Plugin', 'MIG 切分', '节点发现', '驱动生命周期'],
  },
  {
    key: '可观测性',
    domain: '平台工程',
    center: [-0.35, -0.3],
    spread: [0.092, 0.045],
    angle: -0.3,
    prominence: 1.05,
    concepts: ['GPU 指标', '分布式 Trace', '训练任务监控', '推理服务监控', '告警与归因'],
  },
  {
    key: 'Benchmark',
    domain: '平台工程',
    center: [0.2, -0.28],
    spread: [0.055, 0.085],
    angle: -0.12,
    prominence: 0.78,
    concepts: ['吞吐量与延迟', 'TTFT 与 TPOT', '训练 MFU', '端到端压测', '容量规划'],
  },
  {
    key: 'Agent Infra',
    domain: '平台工程',
    center: [0.56, -0.3],
    spread: [0.092, 0.048],
    angle: 0.34,
    prominence: 1.2,
    concepts: ['Agent Runtime', 'Tool Calling', 'RAG 基础设施', 'Eval 与 Trace', '成本与限流'],
  },
]

export function createDemoProject(): TerrainProject {
  const notes = Array.from({ length: topics.length * articlesPerTopic }, (_, index) => createDemoNote(index))
  const bridgeStride = Math.max(1, Math.floor(topics.length / 3))
  for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
    const from = notes[topicIndex]
    const to = notes[(topicIndex + bridgeStride) % topics.length]
    if (from && to && from.area !== to.area) from.links = [to.title]
  }
  const terrain = buildTerrainData(notes, 128, 'Asia/Shanghai', 0.052)
  const timestamp = '2025-12-31T20:00:00+08:00'
  return {
    schemaVersion: 3,
    id: 'demo-ai-infra-terrain',
    name: 'AI Infra 知识地形',
    createdAt: timestamp,
    updatedAt: timestamp,
    timeZone: 'Asia/Shanghai',
    modelId: 'demo-ai-infra-layout-v1',
    embeddingMode: 'demo',
    sourceDigest: `ai-infra-demo-${notes.length}`,
    gridSize: 128,
    notes,
    snapshots: terrain.snapshots,
    peaks: topics.map((topic, topicIndex) => ({
      id: `ai-infra-peak-${topicIndex + 1}`,
      x: topic.center[0],
      y: topic.center[1],
      height: 0,
      label: topic.key,
      noteIds: notes
        .filter((_, noteIndex) => noteIndex % topics.length === topicIndex)
        .map((note) => note.id),
    })),
    noteNeighbors: computeNeighbors(notes, 6),
    cognitiveStates: buildCognitiveStates(notes, timestamp),
    interactionEvents: [],
    terrainProfiles: DEFAULT_TERRAIN_PROFILES.map((profile) => ({ ...profile })),
    activeTerrainProfileId: DEFAULT_TERRAIN_PROFILE_ID,
  }
}

export function createProjectFromNotes(name: string, notes: TerrainNote[], modelId = 'local-analysis'): TerrainProject {
  const terrain = buildTerrainData(notes)
  const timestamp = new Date().toISOString()
  return {
    schemaVersion: 3,
    id: `project-${hash(`${name}-${timestamp}`)}`,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    timeZone: 'Asia/Shanghai',
    modelId,
    embeddingMode: modelId === 'deterministic-local-fallback' ? 'fallback' : 'semantic',
    sourceDigest: hash(notes.map((note) => note.fingerprint).join('|')),
    gridSize: Math.sqrt(terrain.snapshots[0]?.values.length ?? 128 * 128),
    notes,
    snapshots: terrain.snapshots,
    peaks: terrain.peaks,
    noteNeighbors: computeNeighbors(notes, 6),
    cognitiveStates: buildCognitiveStates(notes, timestamp),
    interactionEvents: [],
    terrainProfiles: DEFAULT_TERRAIN_PROFILES.map((profile) => ({ ...profile })),
    activeTerrainProfileId: DEFAULT_TERRAIN_PROFILE_ID,
  }
}

function buildCognitiveStates(notes: TerrainNote[], updatedAt: string): TerrainProject['cognitiveStates'] {
  return notes.flatMap((note) => {
    const state = cognitiveStateFromNote(
      note,
      note.cognitiveStateProvenance ?? 'migration',
      note.reviewedAt ?? updatedAt,
    )
    return state ? [state] : []
  })
}

function createDemoNote(index: number): TerrainNote {
  const topicIndex = index % topics.length
  const topicArticleIndex = Math.floor(index / topics.length)
  const topic = topics[topicIndex]
  const concept = topic.concepts[topicArticleIndex % topic.concepts.length]
  const lens = articleLenses[Math.floor(topicArticleIndex / topic.concepts.length)]
  const title = lens ? `${concept}：${lens}` : concept
  const createdAt = demoDate(index)
  const [x, y] = demoPosition(topic, topicIndex, topicArticleIndex)
  const id = `ai-infra-note-${String(index + 1).padStart(4, '0')}`

  return {
    id,
    fingerprint: id,
    title,
    content: '',
    createdAt: createdAt.toISOString(),
    createdAtMs: createdAt.getTime(),
    tags: [topic.domain, topic.key],
    source: 'AI Infra Knowledge Base',
    weight: topic.prominence,
    mastery: 0.62 + ((index * 17) % 31) / 100,
    confidence: 0.58 + ((index * 11) % 36) / 100,
    exploration: 0.35 + ((index * 7) % 61) / 100,
    status: index % 19 === 0 ? 'seed' : index % 13 === 0 ? 'stable' : 'growing',
    area: topic.domain,
    areas: topic.key === 'Agent Infra'
      ? [topic.domain, 'Agent 系统']
      : index === 0
        ? [topic.domain, '计算机体系结构']
        : [topic.domain],
    links: [],
    x,
    y,
  }
}

function demoDate(index: number): Date {
  if (index === 0) return new Date(demoStart)
  const date = new Date(demoStart)
  date.setDate(1)
  date.setMonth(demoStart.getMonth() + Math.floor(index / articlesPerMonth))
  date.setDate(2 + ((index * 7) % 25))
  date.setHours(8 + (index % 13), (index * 11) % 60, (index * 17) % 60, 0)
  return date
}

function demoPosition(topic: DemoTopic, topicIndex: number, articleIndex: number): readonly [number, number] {
  if (topicIndex === 0 && articleIndex === 0) return topic.center

  const seed = topicIndex * articlesPerTopic + articleIndex
  const [gaussianX, gaussianY] = gaussianPair(seed + 1)
  const conceptAngle = ((articleIndex % topic.concepts.length) / topic.concepts.length) * Math.PI * 2
  const localX = gaussianX * topic.spread[0] + Math.cos(conceptAngle) * topic.spread[0] * 0.24
  const localY = gaussianY * topic.spread[1] + Math.sin(conceptAngle) * topic.spread[1] * 0.24
  const cosine = Math.cos(topic.angle)
  const sine = Math.sin(topic.angle)
  return [
    clamp(topic.center[0] + localX * cosine - localY * sine, -0.92, 0.92),
    clamp(topic.center[1] + localX * sine + localY * cosine, -0.88, 0.9),
  ]
}

function gaussianPair(seed: number): readonly [number, number] {
  const u = Math.max(0.000001, randomUnit(seed * 2 + 1))
  const v = randomUnit(seed * 2 + 2)
  const magnitude = Math.sqrt(-2 * Math.log(u))
  const angle = Math.PI * 2 * v
  return [
    clamp(magnitude * Math.cos(angle), -2.15, 2.15),
    clamp(magnitude * Math.sin(angle), -2.15, 2.15),
  ]
}

function randomUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function hash(value: string): string {
  let hashValue = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index)
    hashValue = Math.imul(hashValue, 16777619)
  }
  return (hashValue >>> 0).toString(16).padStart(8, '0')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
