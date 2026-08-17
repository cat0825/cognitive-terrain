import { sha256Bytes } from '../domain/vault-writeback'

type VaultPermissionMode = 'read' | 'readwrite'

interface VaultPermissionDescriptor {
  mode: VaultPermissionMode
}

interface PermissionAwareDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(descriptor: VaultPermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor: VaultPermissionDescriptor): Promise<PermissionState>
}

interface VaultDirectoryPickerOptions {
  mode: 'readwrite'
}

export type VaultDirectoryPicker = (
  options: VaultDirectoryPickerOptions,
) => Promise<FileSystemDirectoryHandle>

export type VaultFileAccessErrorCode =
  | 'permission-denied'
  | 'not-found'
  | 'type-mismatch'
  | 'write-failed'

export class VaultFileAccessError extends Error {
  readonly code: VaultFileAccessErrorCode
  readonly path?: string

  constructor(code: VaultFileAccessErrorCode, message: string, options?: { cause?: unknown; path?: string }) {
    super(message, { cause: options?.cause })
    this.name = 'VaultFileAccessError'
    this.code = code
    this.path = options?.path
  }
}

export interface VaultFileBytes {
  path: string
  bytes: Uint8Array
  byteHash: string
}

export interface VaultFileRead extends VaultFileBytes {
  text: string
}

export async function pickVaultDirectoryForWrite(
  picker: VaultDirectoryPicker = browserDirectoryPicker,
): Promise<FileSystemDirectoryHandle> {
  let handle: FileSystemDirectoryHandle
  try {
    handle = await picker({ mode: 'readwrite' })
  } catch (error) {
    throw accessError(error, 'permission-denied', undefined, '无法获得 vault 目录的读写权限')
  }
  if (handle.kind !== 'directory') {
    throw new VaultFileAccessError('type-mismatch', '所选对象不是目录')
  }
  await ensureVaultReadWritePermission(handle)
  return handle
}

export async function ensureVaultReadWritePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  if (handle.kind !== 'directory') {
    throw new VaultFileAccessError('type-mismatch', 'vault 根句柄不是目录')
  }
  const permissionHandle = handle as Partial<PermissionAwareDirectoryHandle>
  if (typeof permissionHandle.queryPermission !== 'function' || typeof permissionHandle.requestPermission !== 'function') {
    throw new VaultFileAccessError('permission-denied', '当前浏览器无法验证 vault 目录的读写权限')
  }
  const descriptor: VaultPermissionDescriptor = { mode: 'readwrite' }
  try {
    if (await permissionHandle.queryPermission(descriptor) === 'granted') return
    if (await permissionHandle.requestPermission(descriptor) === 'granted') return
  } catch (error) {
    throw accessError(error, 'permission-denied', undefined, 'vault 目录的读写授权失败')
  }
  throw new VaultFileAccessError('permission-denied', 'vault 目录没有读写权限')
}

export async function resolveVaultFileHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  if (root.kind !== 'directory') {
    throw new VaultFileAccessError('type-mismatch', 'vault 根句柄不是目录', { path: relativePath })
  }
  const { path, segments } = vaultPath(relativePath)
  let directory = root
  for (const segment of segments.slice(0, -1)) {
    try {
      const child = await directory.getDirectoryHandle(segment, { create: false })
      if (child.kind !== 'directory') {
        throw new VaultFileAccessError('type-mismatch', `路径段不是目录：${segment}`, { path })
      }
      directory = child
    } catch (error) {
      throw accessError(error, 'not-found', path, `找不到 vault 目录：${segment}`)
    }
  }
  const fileName = segments.at(-1) as string
  try {
    const handle = await directory.getFileHandle(fileName, { create: false })
    if (handle.kind !== 'file') {
      throw new VaultFileAccessError('type-mismatch', `路径目标不是文件：${path}`, { path })
    }
    return handle
  } catch (error) {
    throw accessError(error, 'not-found', path, `找不到 vault 文件：${path}`)
  }
}

export async function readVaultFileBytes(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<VaultFileRead> {
  const path = vaultPath(relativePath).path
  const handle = await resolveVaultFileHandle(root, path)
  try {
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
    const text = decodeVaultText(bytes, path)
    return { path, bytes, text, byteHash: await sha256Bytes(bytes) }
  } catch (error) {
    const mapped = knownAccessError(error, path)
    if (mapped) throw mapped
    throw error
  }
}

export async function writeVaultFileBytes(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  bytes: Uint8Array,
): Promise<VaultFileBytes> {
  const path = vaultPath(relativePath).path
  const handle = await resolveVaultFileHandle(root, path)
  try {
    const writable = await handle.createWritable({ keepExistingData: false })
    await writable.write(bytes.slice())
    await writable.close()
    const written = new Uint8Array(await (await handle.getFile()).arrayBuffer())
    return { path, bytes: written, byteHash: await sha256Bytes(written) }
  } catch (error) {
    throw accessError(error, 'write-failed', path, `写入 vault 文件失败：${path}`)
  }
}

async function browserDirectoryPicker(options: VaultDirectoryPickerOptions): Promise<FileSystemDirectoryHandle> {
  const picker = (globalThis as typeof globalThis & { showDirectoryPicker?: VaultDirectoryPicker }).showDirectoryPicker
  if (!picker) {
    throw new VaultFileAccessError('permission-denied', '当前浏览器不支持目录读写 API')
  }
  return picker.call(globalThis, options)
}

function vaultPath(value: string): { path: string; segments: string[] } {
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/')
  const segments = path.split('/')
  if (!path || path.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new VaultFileAccessError('not-found', `vault 相对路径无效：${value}`, { path: value })
  }
  return { path, segments }
}

function accessError(
  error: unknown,
  fallback: VaultFileAccessErrorCode,
  path: string | undefined,
  message: string,
): VaultFileAccessError {
  if (error instanceof VaultFileAccessError) return error
  return knownAccessError(error, path) ?? new VaultFileAccessError(fallback, errorMessage(error, message), { cause: error, path })
}

function knownAccessError(error: unknown, path: string | undefined): VaultFileAccessError | undefined {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  const cause = { cause: error, path }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'AbortError') {
    return new VaultFileAccessError('permission-denied', errorMessage(error, 'vault 目录访问被拒绝'), cause)
  }
  if (name === 'NotFoundError') {
    return new VaultFileAccessError('not-found', errorMessage(error, 'vault 路径不存在'), cause)
  }
  if (name === 'TypeMismatchError') {
    return new VaultFileAccessError('type-mismatch', errorMessage(error, 'vault 路径类型不匹配'), cause)
  }
  return undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function decodeVaultText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (error) {
    throw new VaultFileAccessError('type-mismatch', `vault 文件不是有效的 UTF-8：${path}`, { cause: error, path })
  }
}
