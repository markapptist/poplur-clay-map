// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PostDeleteDialog from '../PostDeleteDialog'

let root: Root
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = '' })
describe('post deletion confirmation', () => {
  it('escapes the transformed viewer, focuses Keep, cancels and restores focus', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div'); host.style.transform = 'translateY(20px)'
    const trigger = document.createElement('button'); document.body.append(trigger, host); trigger.focus()
    root = createRoot(host)
    const onDelete = vi.fn(), onCancel = vi.fn()
    act(() => root.render(<PostDeleteDialog dataId="fixture" onDelete={onDelete} onCancel={onCancel} />))
    expect(host.querySelector('[role=dialog]')).toBeNull()
    const overlay = document.body.querySelector('[data-post-delete-overlay]')!
    expect(overlay.parentElement).toBe(document.body)
    expect(document.activeElement?.textContent).toBe('Keep it')
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(onCancel).toHaveBeenCalledOnce(); expect(onDelete).not.toHaveBeenCalled()
    act(() => root.render(null)); expect(document.activeElement).toBe(trigger)
  })
  it('only the destructive button requests deletion', () => {
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    const onDelete = vi.fn(), onCancel = vi.fn()
    act(() => root.render(<PostDeleteDialog dataId="fixture" onDelete={onDelete} onCancel={onCancel} />))
    const buttons = [...document.querySelectorAll('button')]
    act(() => buttons.find(button => button.textContent === 'Delete post')!.click())
    expect(onDelete).toHaveBeenCalledOnce(); expect(onCancel).not.toHaveBeenCalled()
  })
})
