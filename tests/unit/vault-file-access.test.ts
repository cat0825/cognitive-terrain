import { describe, expect, it, vi } from 'vitest'
import { sha256Bytes } from '../../src/domain/vault-writeback'
import {
  ensureVaultReadWritePermission,
  pickVaultDirectoryForWrite,
  readVaultFileBytes,
  resolveVaultFileHandle,
  writeVaultFileBytes,
} from '../../src/import/vault-file-access'

describe('vault file access', () => {
  it('picks a directory in readwrite mode and requests permission when needed', async () => {
    const handle = directoryHandle('AtlasVault')
    const queryPermission = vi.fn().mockResolvedValue('prompt')
    const requestPermission = vi.fn().mockResolvedValue('granted')
    Object.assign(handle, { queryPermission, requestPermission })
    const picker = vi.fn().mockResolvedValue(handle)

    await expect(pickVaultDirectoryForWrite(picker)).resolves.toBe(handle)
    expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('reports denied readwrite permission with a stable code', async () => {
    const handle = directoryHandle('AtlasVault')
    Object.assign(handle, {
      queryPermission: vi.fn().mockResolvedValue('denied'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })

    await expect(ensureVaultReadWritePermission(handle)).rejects.toMatchObject({
      name: 'VaultFileAccessError',
      code: 'permission-denied',
    })
  })

  it('resolves nested handles and reads original bytes with their hash', async () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a])
    const note = fileHandle('Note.md', original)
    const math = directoryHandle('Math', { files: { 'Note.md': note } })
    const root = directoryHandle('AtlasVault', { directories: { Math: math } })

    await expect(resolveVaultFileHandle(root, 'Math\\Note.md')).resolves.toBe(note)
    await expect(readVaultFileBytes(root, './Math/Note.md')).resolves.toEqual({
      path: 'Math/Note.md',
      bytes: original,
      text: '\ufeffa\r\n',
      byteHash: await sha256Bytes(original),
    })
  })

  it('rejects invalid UTF-8 instead of replacing bytes during read', async () => {
    const note = fileHandle('Invalid.md', new Uint8Array([0xc3, 0x28]))
    const root = directoryHandle('AtlasVault', { files: { 'Invalid.md': note } })

    await expect(readVaultFileBytes(root, 'Invalid.md')).rejects.toMatchObject({
      code: 'type-mismatch',
      message: 'vault 文件不是有效的 UTF-8：Invalid.md',
    })
  })

  it('distinguishes missing paths and directory/file type mismatches', async () => {
    const missing = directoryHandle('AtlasVault')
    const wrongDirectory = directoryHandle('AtlasVault', {
      directoryErrors: { Math: new DOMException('Math is a file', 'TypeMismatchError') },
    })

    await expect(resolveVaultFileHandle(missing, 'Math/Note.md')).rejects.toMatchObject({ code: 'not-found' })
    await expect(resolveVaultFileHandle(wrongDirectory, 'Math/Note.md')).rejects.toMatchObject({
      code: 'type-mismatch',
    })
  })

  it('writes bytes, closes the stream, then returns bytes and hash read from disk', async () => {
    const note = fileHandle('Note.md', new TextEncoder().encode('before'))
    const root = directoryHandle('AtlasVault', { files: { 'Note.md': note } })
    const after = new TextEncoder().encode('after')

    await expect(writeVaultFileBytes(root, 'Note.md', after)).resolves.toEqual({
      path: 'Note.md',
      bytes: after,
      byteHash: await sha256Bytes(after),
    })
  })

  it('maps unexpected stream errors to write-failed without hiding permission errors', async () => {
    const broken = fileHandle('Broken.md', new Uint8Array(), new Error('disk full'))
    const revoked = fileHandle(
      'Revoked.md',
      new Uint8Array(),
      new DOMException('permission revoked', 'NotAllowedError'),
    )
    const root = directoryHandle('AtlasVault', { files: { 'Broken.md': broken, 'Revoked.md': revoked } })

    await expect(writeVaultFileBytes(root, 'Broken.md', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'write-failed',
      message: 'disk full',
    })
    await expect(writeVaultFileBytes(root, 'Revoked.md', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })
})

interface DirectoryContents {
  directories?: Record<string, FileSystemDirectoryHandle>
  files?: Record<string, FileSystemFileHandle>
  directoryErrors?: Record<string, Error>
}

function directoryHandle(name: string, contents: DirectoryContents = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: vi.fn(async (childName: string) => {
      const failure = contents.directoryErrors?.[childName]
      if (failure) throw failure
      const child = contents.directories?.[childName]
      if (!child) throw new DOMException('missing directory', 'NotFoundError')
      return child
    }),
    getFileHandle: vi.fn(async (childName: string) => {
      const child = contents.files?.[childName]
      if (!child) throw new DOMException('missing file', 'NotFoundError')
      return child
    }),
  } as unknown as FileSystemDirectoryHandle
}

function fileHandle(name: string, initial: Uint8Array, writeError?: Error): FileSystemFileHandle {
  let bytes = initial.slice()
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => new File([bytes], name)),
    createWritable: vi.fn(async () => {
      if (writeError) throw writeError
      let pending = bytes
      return {
        write: vi.fn(async (value: FileSystemWriteChunkType) => {
          if (!(value instanceof Uint8Array)) throw new TypeError('expected Uint8Array')
          pending = value.slice()
        }),
        close: vi.fn(async () => {
          bytes = pending
        }),
      } as unknown as FileSystemWritableFileStream
    }),
  } as unknown as FileSystemFileHandle
}
