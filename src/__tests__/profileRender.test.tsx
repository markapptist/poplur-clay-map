// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('renders the main Profile tab without a render exception', async () => {
  const { default: ProfileTwin } = await import('../ProfileTwin')
  expect(renderToStaticMarkup(<ProfileTwin />)).toContain('data-radius-meter="account"')
})

it('mounts and hydrates the main Profile tab', async () => {
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const { default: ProfileTwin } = await import('../ProfileTwin')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<ProfileTwin />) })
    expect(container.querySelector('[data-poplur-screen="profile"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('mounts Settings when Profile resumes its last page', async () => {
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const { default: SettingsScreen } = await import('../SettingsScreen')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<SettingsScreen />) })
    expect(container.textContent).toContain('Blocked')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
