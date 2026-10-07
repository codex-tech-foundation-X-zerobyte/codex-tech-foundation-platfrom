import test from 'node:test'
import assert from 'node:assert/strict'
import { safeFileName, storageKey, validateChatFile, formatBytes, storageError, CHAT_MAX_BYTES } from '../src/lib/storagePath.ts'

// Characters Supabase Storage accepts in a key (plus the "/" separators we add ourselves).
const SAFE = /^[A-Za-z0-9._-]+$/

test('macOS screenshot names (contain an invisible U+202F before PM) become safe', () => {
  const name = 'Screenshot 2026-09-30 at 5.12.44\u202fPM.png'
  assert.equal(/[^\x20-\x7e]/.test(name), true) // really contains a non-ASCII character
  const safe = safeFileName(name)
  assert.match(safe, SAFE)
  assert.equal(safe, 'Screenshot-2026-09-30-at-5.12.44-PM.png')
})

test('phone photos, brackets, hashes, emoji and accents', () => {
  assert.equal(safeFileName('IMG 0001 (1).JPG'), 'IMG-0001-1.jpg')
  assert.equal(safeFileName('plan [final] #2.pdf'), 'plan-final-2.pdf')
  assert.equal(safeFileName('Café menü 🍕.png'), 'Cafe-menu.png')
  for (const n of ['a b.png', 'x%20y.png', 'q?.png', 'a&b=c.png', 'tab\there.png', 'new\nline.png']) assert.match(safeFileName(n), SAFE, n)
})

test('names with no Latin characters still produce a valid key and keep their extension', () => {
  assert.equal(safeFileName('日本語のファイル.pdf'), 'file.pdf')
  assert.equal(safeFileName('🍕🍕🍕'), 'file')
  assert.equal(safeFileName(''), 'file')
})

test('path traversal and hidden-file tricks are neutralised', () => {
  for (const n of ['../../etc/passwd', '..\\..\\windows\\system32', '/abs/path/file.txt', '.hidden', '...', 'a/../../b.png']) {
    const safe = safeFileName(n)
    assert.match(safe, SAFE, n)
    assert.ok(!safe.startsWith('.') && !safe.includes('..') && !safe.includes('/'), `${n} -> ${safe}`)
  }
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
})

test('very long names are shortened but keep the extension', () => {
  const safe = safeFileName('a'.repeat(500) + '.mp4')
  assert.ok(safe.length <= 91)
  assert.ok(safe.endsWith('.mp4'))
})

test('storageKey is unique per upload and always safe', () => {
  const a = storageKey(['chan', 'user'], 'My Photo (1).PNG', 1000)
  assert.equal(a, 'chan/user/1000-My-Photo-1.png')
  assert.notEqual(a, storageKey(['chan', 'user'], 'My Photo (1).PNG', 1001))
})

test('chat file validation gives a clear reason up front', () => {
  assert.equal(validateChatFile({ name: 'a.png', type: 'image/png', size: 1000 }), null)
  assert.equal(validateChatFile({ name: 'v.mp4', type: 'video/mp4', size: CHAT_MAX_BYTES }), null)
  assert.match(validateChatFile({ name: 'big.mp4', type: 'video/mp4', size: CHAT_MAX_BYTES + 1 }), /limit is 50 MB/)
  assert.match(validateChatFile({ name: 'x.exe', type: 'application/x-msdownload', size: 10 }), /can't be sent here/)
  assert.match(validateChatFile({ name: 'noext', type: '', size: 10 }), /unknown type/)
  assert.match(validateChatFile({ name: 'e.png', type: 'image/png', size: 0 }), /empty/)
  assert.equal(validateChatFile({ name: 'd.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10 }), null)
})

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B'); assert.equal(formatBytes(2048), '2.0 KB'); assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB'); assert.equal(formatBytes(50 * 1024 * 1024), '50 MB')
})

test('storage errors are translated, and the raw text is kept for diagnostics', () => {
  assert.equal(storageError({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }).message, 'That file is larger than the upload limit.')
  assert.equal(storageError({ message: 'new row violates row-level security policy', statusCode: '403' }).message, "You don't have permission to upload here.")
  assert.equal(storageError({ message: 'Invalid key: a b', statusCode: '400' }).message, "That file's name has characters the storage service can't accept.")
  assert.equal(storageError({ message: 'mime type text/html is not supported', statusCode: '415' }).message, "That file type isn't allowed.")
  assert.equal(storageError({ message: 'Bucket not found', statusCode: '404' }).message.startsWith('The storage location'), true)
  const unknown = storageError({ message: 'something odd', statusCode: '500' })
  assert.equal(unknown.message, 'something odd'); assert.equal(unknown.status, 500); assert.equal(unknown.technical, 'something odd')
})
