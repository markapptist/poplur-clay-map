import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8')

describe('upload-flow Poplur clay UI contract', () => {
  it('identifies each live stage and keeps the working flow in glossy clay panels', () => {
    const review = source('UploadFlowReview.tsx')
    const reviewCss = source('UploadFlowReview.module.css')
    const status = source('UploadStatusView.tsx')
    const statusCss = source('UploadStatusView.module.css')

    expect(review).toContain('data-upload-flow={flow}')
    expect(review).toContain('data-upload-stage={current.id}')
    expect(status).toContain("data-upload-tone={complete ? 'posted-white' : 'working-clay'}")
    expect(reviewCss).toContain('--clay-pink: #ff168d')
    expect(reviewCss).toContain('border: 5px solid var(--clay-pink)')
    expect(statusCss).toContain('linear-gradient(165deg, #2c2a2d 0%, #111012 56%, #080708 100%)')
    expect(reviewCss).toContain('min-height: 44px')
    expect(statusCss).toContain('overflow-y: auto')
  })

  it('uses the existing pre-login confetti over a white posted-stage finish', () => {
    const status = source('UploadStatusView.tsx')
    const statusCss = source('UploadStatusView.module.css')

    expect(status).toContain("import NotifConfetti from './NotifConfetti'")
    expect(status).toContain('<NotifConfetti />')
    expect(statusCss).toMatch(/\.completeScreen\s*\{[\s\S]*?background:\s*#fff;/)
    expect(statusCss).toMatch(/\.postedOverlay\s*\{[\s\S]*?overflow-y:\s*auto;/)
    expect(statusCss).not.toContain('@keyframes confetti')
    expect(statusCss).not.toContain('.confetti i')
  })
})
