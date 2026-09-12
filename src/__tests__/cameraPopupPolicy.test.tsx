// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { setCameraPopupsSuppressed } from '../cameraPopupPolicy'
import PoplurStatusToast from '../PoplurStatusToast'
import PoplurDialog from '../PoplurDialog'
import ScreenCoach from '../ScreenCoach'
import PermissionAlert from '../PermissionAlert'
import PopupHost, { showPopup, clearPopups } from '../popups'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('blocks shared cards and drops new notifications throughout a camera session', () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(<>
    <PoplurStatusToast title="Status" detail="Notice" />
    <PoplurDialog title="Dialog" onClose={() => {}} />
    <ScreenCoach id="camera-policy-test" title="Coach" lines={['Hint']} />
    <PermissionAlert icon="camera" title="Permission" copy="Ask" label="Permission" choices={[]} />
    <PopupHost />
  </>))
  expect(host.textContent).toContain('Status')
  act(() => { setCameraPopupsSuppressed(true); clearPopups(); showPopup({kind:'engagement',text:'Must not appear'}) })
  expect(host.textContent).toBe('')
  expect(document.documentElement.hasAttribute('data-camera-no-popups')).toBe(true)
  expect(document.body.textContent).not.toContain('Must not appear')
  act(() => setCameraPopupsSuppressed(false))
  expect(host.textContent).toContain('Status')
  expect(document.body.textContent).not.toContain('Must not appear')
  act(() => root.unmount()); host.remove(); clearPopups()
})
