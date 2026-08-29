import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PoplurStatusToast from '../PoplurStatusToast'

describe('PoplurStatusToast', () => {
  it('announces live status copy atomically without baking sample UI text', () => {
    const markup = renderToStaticMarkup(
      <PoplurStatusToast title="Post ready" detail="Post link copied" />,
    )
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('Post link copied')
    expect(markup).not.toContain('Harbourfront')
    expect(markup).not.toContain('Reaching more people')
  })

  it('does not paint failed work with a success check', () => {
    const markup = renderToStaticMarkup(
      <PoplurStatusToast title="Not completed" detail="Sharing cancelled" tone="error" />,
    )
    expect(markup).toContain('>!<')
    expect(markup).not.toContain('>✓<')
  })
})
