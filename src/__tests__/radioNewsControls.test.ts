import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('Radio and News control wiring', () => {
  it('routes the Radio share control through the real share pipeline', () => {
    const radio = source('RadioScreen.tsx')
    expect(radio).toMatch(/const shareTunedStation[\s\S]*?shareRadioStation\(station\)\.then\(showControlNote\)/)
    expect(radio).toMatch(/icon="feed\.share"[\s\S]*?requireTuned\('share'\)[\s\S]*?shareTunedStation\(station\)/)
    expect(radio).toMatch(/Pick a station before you \$\{action\}/)
  })

  it('keeps the News controls visible but reports unavailable delivery without local success', () => {
    const news = source('NewsPaper.tsx')
    expect(news).toMatch(/const submitReply[\s\S]*?showEngagementFailure\('reply', entry\.id\)/)
    expect(news).toMatch(/const repop[\s\S]*?showEngagementFailure\('repop', entry\.id\)/)
    expect(news).toMatch(/onSubmit=\{event => \{ event\.preventDefault\(\); submitReply\(entry\) \}\}/)
    expect(news).toMatch(/<PoplurStatusToast[\s\S]*?tone="error"/)
    expect(news).not.toMatch(/addNewsReply|toggleNewsRepop|writeNewsEngagement/)
  })

  it('delegates article keys to the nested-control-aware handler', () => {
    const news = source('NewsPaper.tsx')
    expect(news).toMatch(/onKeyDown=\{event => \{[\s\S]*?handleNewsEntryKey\(event, \(\) =>/)
  })

  it('makes the live-news plate enter the exact existing map-news route', () => {
    const news = source('NewsPaper.tsx')
    expect(news).toMatch(/const focusLiveEventOnMap[\s\S]*?poplur-news-focus-map/)
    expect(news).toMatch(/VIEW ON THE NEWS TOUR[\s\S]*?<\/button>/)
    expect(news).toMatch(/className=\{`\$\{styles\.detailWho\} \$\{styles\.detailWhoStatic\}`\}/)
  })
})
