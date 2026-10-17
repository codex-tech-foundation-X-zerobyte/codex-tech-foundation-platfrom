import test from 'node:test'
import assert from 'node:assert/strict'
import { snippet, notificationPush, chatPush, callPush, groupCallPush, homePathForRole, isGoneStatus, isPushAllowed } from '../supabase/functions/_shared/pushPayload.ts'
import { urlBase64ToUint8Array } from '../src/lib/pushKey.ts'

test('snippet collapses whitespace and cuts on a word boundary', () => {
  assert.equal(snippet('  hello \n\n  world  '), 'hello world')
  const long = 'word '.repeat(60)
  const out = snippet(long, 50)
  assert.ok(out.length <= 50 && out.endsWith('…') && !out.includes('wor…'))
  assert.equal(snippet(null), '')
})

test('home path follows the role; unknown roles get the admin shell only for staff roles', () => {
  assert.equal(homePathForRole('client'), '/client')
  assert.equal(homePathForRole('worker'), '/worker')
  assert.equal(homePathForRole('superadmin'), '/admin')
})

test('a notification row becomes a push that opens that person\'s own notifications page', () => {
  const m = notificationPush({ id: 'n1', title: 'Update on Apollo', body: 'Milestone shipped' }, 'client')
  assert.deepEqual([m.title, m.body, m.url, m.tag], ['Update on Apollo', 'Milestone shipped', '/client/notifications', 'notification-n1'])
})

test('direct messages are titled with the sender, group messages with sender and channel', () => {
  const dm = chatPush({ channel_id: 'c1', body: 'lunch?' }, { senderName: 'Ada', channelType: 'dm', channelName: '' }, 'worker')
  assert.equal(dm.title, 'Ada'); assert.equal(dm.url, '/worker/chat?channel=c1'); assert.equal(dm.tag, 'chat-c1')
  const grp = chatPush({ channel_id: 'c2', body: 'deploy done' }, { senderName: 'Ada', channelType: 'group', channelName: 'Backend' }, 'worker')
  assert.equal(grp.title, 'Ada in Backend')
})

test('attachment-only messages still say something useful, and the channel id is URL-encoded', () => {
  const one = chatPush({ channel_id: 'a b', body: '', attachments: [{}] }, { senderName: 'Ada', channelType: 'dm', channelName: '' }, 'admin')
  assert.equal(one.body, 'Sent an attachment'); assert.equal(one.url, '/admin/chat?channel=a%20b')
  const many = chatPush({ channel_id: 'c', body: '  ', attachments: [{}, {}, {}] }, { senderName: 'Ada', channelType: 'dm', channelName: '' }, 'admin')
  assert.equal(many.body, 'Sent 3 attachments')
})

test('calls stay on screen until handled', () => {
  const c = callPush({ id: 'k1', type: 'video' }, { callerName: 'Ada' }, 'worker')
  assert.equal(c.title, 'Incoming video call'); assert.equal(c.requireInteraction, true)
  const g = groupCallPush({ id: 'g1', channel_id: 'c9', type: 'voice' }, { starterName: 'Ada', channelName: 'Ops', isDirect: false }, 'worker')
  assert.equal(g.body, 'in Ops — tap to join'); assert.equal(g.requireInteraction, true)
})

test('only 404/410 mean a device is gone', () => {
  assert.ok(isGoneStatus(410) && isGoneStatus(404))
  assert.ok(!isGoneStatus(500) && !isGoneStatus(429) && !isGoneStatus(undefined))
})

test('VAPID public keys decode from base64url to the 65-byte uncompressed point', () => {
  const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
  const bytes = urlBase64ToUint8Array(key)
  assert.equal(bytes.length, 65); assert.equal(bytes[0], 0x04)
})

test('push respects the master switch and each event kind; everything is on until switched off', () => {
  assert.equal(isPushAllowed(undefined, 'chat'), true)                                  // no preference row yet
  assert.equal(isPushAllowed({ push: true, events: {} }, 'chat'), true)
  assert.equal(isPushAllowed({ push: false }, 'chat'), false)                           // master off beats everything
  assert.equal(isPushAllowed({ push: true, events: { chat: { push: false } } }, 'chat'), false)
  assert.equal(isPushAllowed({ push: true, events: { chat: { push: false } } }, 'tasks'), true) // other kinds unaffected
  assert.equal(isPushAllowed({ push: true, events: { tasks: { in_app: false } } }, 'tasks'), true) // in-app off does not mean push off
  assert.equal(isPushAllowed({ push: true, events: { general: { push: false } } }, 'general'), true) // admin messages are not filterable
})
