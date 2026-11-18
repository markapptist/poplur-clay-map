// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import PostReportDialog from '../PostReportDialog'

const bridge = vi.hoisted(() => ({ native: true, send: vi.fn(() => true) }))
vi.mock('../nativeBridge', async importOriginal => ({
  ...await importOriginal<typeof import('../nativeBridge')>(),
  isNativeShell: () => bridge.native,
  postNativeEvent: bridge.send,
}))
const { reportPost } = await import('../blockedUsers')

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => { bridge.send.mockClear(); bridge.send.mockReturnValue(true); bridge.native = true })

it('hands a pop report to the native shell with the pop and its owner', async () => {
  await expect(reportPost({ postId: ' p1 ', ownerUid: 'owner', username: '@maya' })).resolves.toBe('native')
  expect(bridge.send).toHaveBeenCalledWith({ type: 'reportPost', postId: 'p1', userId: 'owner', username: '@maya', reason: 'pop' })
})

it('never files a pop report without the pop id and its owner', async () => {
  await expect(reportPost({ postId: '', ownerUid: 'owner' })).resolves.toBe('local')
  await expect(reportPost({ postId: 'p1', ownerUid: null })).resolves.toBe('local')
  expect(bridge.send).not.toHaveBeenCalled()
})

it('says it could not send when neither the shell nor the web can file it', async () => {
  bridge.native = false
  bridge.send.mockReturnValue(false)
  await expect(reportPost({ postId: 'p1', ownerUid: 'owner' })).resolves.toBe('local')
})

it('the confirmation reports only on the Report button', async () => {
  const onReport = vi.fn()
  const onCancel = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<PostReportDialog onReport={onReport} onCancel={onCancel} dataId="test" />))
  const buttons = [...document.body.querySelectorAll('[data-poplur-dialog="test"] button')]
  expect(document.body.textContent).toContain('Report this pop?')
  await act(async () => (buttons.find(b => b.textContent === 'Cancel') as HTMLButtonElement).click())
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onReport).not.toHaveBeenCalled()
  await act(async () => (buttons.find(b => b.textContent === 'Report pop') as HTMLButtonElement).click())
  expect(onReport).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount()); container.remove()
})

it('blocking also files a "blocked" report, so Poplur hears about it (App Review 1.2)', async () => {
  const { blockUser, resetBlockedUsersForTests, isUserBlocked } = await import('../blockedUsers')
  resetBlockedUsersForTests()
  await expect(blockUser({ uid: 'abuser', username: '@abuser' })).resolves.toBe('native')
  expect(isUserBlocked('abuser')).toBe(true)
  expect(bridge.send).toHaveBeenCalledWith({ type: 'reportUser', userId: 'abuser', username: '@abuser', reason: 'blocked' })
  expect(bridge.send).toHaveBeenCalledWith({ type: 'blockUser', userId: 'abuser', username: '@abuser' })
})

it('the dialog offers Block beside Report when given a poster, and each button does only its own job', async () => {
  const onReport = vi.fn(), onBlock = vi.fn(), onCancel = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<PostReportDialog onReport={onReport} onBlock={onBlock} posterName="@maya" onCancel={onCancel} dataId="test" />))
  const block = document.querySelector<HTMLButtonElement>('[data-block-poster]')
  expect(block?.textContent).toBe('Block @maya')
  await act(async () => block!.click())
  expect(onBlock).toHaveBeenCalledTimes(1)
  expect(onReport).not.toHaveBeenCalled()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-report-pop]')!.click())
  expect(onReport).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount()); container.remove()
})

it('without a poster the dialog is the plain report confirmation', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<PostReportDialog onReport={vi.fn()} onCancel={vi.fn()} dataId="test" />))
  expect(document.querySelector('[data-block-poster]')).toBeNull()
  expect(document.body.textContent).toContain('Report this pop?')
  await act(async () => root.unmount()); container.remove()
})
