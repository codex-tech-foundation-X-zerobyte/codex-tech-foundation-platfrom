import test from 'node:test'
import assert from 'node:assert/strict'
import { resourceKind, isPreviewable, contentTypeFor, formatBytes, titleFromFilename, downloadName, extOf } from '../src/lib/resourceKinds.ts'

test('a resource with only a URL is a link, whatever its title says', () => {
  assert.equal(resourceKind({ url: 'https://example.com/a.pdf', storage_path: null, title: 'a.pdf' }), 'link')
})

test('mime type wins, then the extension — octet-stream does not hide a PDF', () => {
  assert.equal(resourceKind({ storage_path: 'x-brief.pdf', mime_type: 'application/octet-stream' }), 'pdf')
  assert.equal(resourceKind({ storage_path: 'x', mime_type: 'image/png' }), 'image')
  assert.equal(resourceKind({ storage_path: 'x-notes.md', mime_type: null }), 'text')
  assert.equal(resourceKind({ storage_path: 'deck.PPTX' }), 'presentation')
  assert.equal(resourceKind({ storage_path: 'mystery.bin' }), 'file')
})

test('only viewable kinds are previewable; office files and archives offer download', () => {
  for (const k of ['image', 'pdf', 'video', 'audio', 'text']) assert.ok(isPreviewable(k), k)
  for (const k of ['document', 'spreadsheet', 'presentation', 'archive', 'file', 'link']) assert.ok(!isPreviewable(k), k)
})

test('blob content type falls back from a useless served type to the extension', () => {
  assert.equal(contentTypeFor({ storage_path: 'a.pdf' }, 'application/octet-stream'), 'application/pdf')
  assert.equal(contentTypeFor({ storage_path: 'a.svg' }, null), 'image/svg+xml')
  assert.equal(contentTypeFor({ storage_path: 'a.png' }, 'image/png'), 'image/png')
  assert.equal(contentTypeFor({ storage_path: 'a.xyz' }, null), 'application/octet-stream')
})

test('sizes read naturally', () => {
  assert.equal(formatBytes(0), '0 B'); assert.equal(formatBytes(900), '900 B'); assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB'); assert.equal(formatBytes(25 * 1024 * 1024), '25 MB')
  assert.equal(formatBytes(null), ''); assert.equal(formatBytes(-1), '')
})

test('titles and download names', () => {
  assert.equal(titleFromFilename('Q3_report-final.pdf'), 'Q3 report-final')
  assert.equal(titleFromFilename('.env'), '.env')
  assert.equal(downloadName({ title: 'Brand guide', storage_path: 'abc-brand.pdf' }), 'Brand guide.pdf')
  assert.equal(downloadName({ title: 'Brand guide.pdf', storage_path: 'abc-brand.pdf' }), 'Brand guide.pdf')
  assert.equal(downloadName({ title: 'a/b\\c:d', storage_path: null }), 'a b c d')
  assert.equal(extOf('Archive.TAR.GZ'), 'gz')
})
