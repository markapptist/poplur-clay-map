// Poplur follows the calendar. Mark's call (31 Oct 2026, filming the demo on
// Halloween): on a holiday the app should LOOK and SOUND like the holiday on
// its own — the Halloween cube, a Halloween map and Halloween stations on the
// map radio — and go back to normal the day after, with no release.
//
// This is the one date source for all of it. seasonalCube.ts asks it for the
// resting cube, MapApp for the map palette and mapRadio for the station tags.
//
// Windows are LOCAL calendar days, every year: the holiday lasts all of its
// last day wherever the phone is, and a clock a few hours off cannot strip or
// extend it mid-evening.

export type HolidayId = 'halloween' | 'christmas' | 'valentine' | 'lunar-new-year' | 'pride'

export interface SeasonalHoliday {
  id: HolidayId
  label: string
  /** MapTheme id in data.ts HOLIDAY_MAP_THEMES. */
  mapThemeId: HolidayId
  /** Radio Browser tags for real holiday streams, best first. Empty = the
   *  normal local station (Radio Browser has no stations for that holiday). */
  radioTags: readonly string[]
  /** Resting cube for every tab root; null where no seasonal model exists. */
  cubeModel: string | null
}

export const HALLOWEEN_CUBE_MODEL = 'poplur_cube_jackolantern.glb'

interface MonthDay { month: number; day: number }   // month 0-based, like Date

interface HolidayWindow {
  holiday: SeasonalHoliday
  /** Same days every year. */
  annual?: { first: MonthDay; last: MonthDay }
  /** Moving holidays: the first day per year, lasting `days` days. */
  dated?: { firstDays: Readonly<Record<number, MonthDay>>; days: number }
}

// Lunar New Year moves every year; first days from the published calendar.
const LUNAR_NEW_YEAR_FIRST_DAYS: Readonly<Record<number, MonthDay>> = {
  2027: { month: 1, day: 6 },
  2028: { month: 0, day: 26 },
  2029: { month: 1, day: 13 },
  2030: { month: 1, day: 3 },
  2031: { month: 0, day: 23 },
}

// First match wins, so the short holidays sit ahead of the long ones they
// can overlap (Valentine's against a mid-February Lunar New Year).
const HOLIDAY_WINDOWS: readonly HolidayWindow[] = [
  {
    holiday: {
      id: 'halloween',
      label: 'Halloween',
      mapThemeId: 'halloween',
      radioTags: ['halloween'],
      cubeModel: HALLOWEEN_CUBE_MODEL,
    },
    // The pumpkin month (Mark, 11 Oct 2026): 1 October through all of the 31st.
    annual: { first: { month: 9, day: 1 }, last: { month: 9, day: 31 } },
  },
  {
    holiday: {
      id: 'christmas',
      label: 'Christmas',
      mapThemeId: 'christmas',
      radioTags: ['christmas', 'christmas music'],
      cubeModel: null,
    },
    annual: { first: { month: 11, day: 1 }, last: { month: 11, day: 26 } },
  },
  {
    holiday: {
      id: 'valentine',
      label: "Valentine's",
      mapThemeId: 'valentine',
      radioTags: ['love songs'],
      cubeModel: null,
    },
    annual: { first: { month: 1, day: 14 }, last: { month: 1, day: 14 } },
  },
  {
    holiday: {
      id: 'lunar-new-year',
      label: 'Lunar New Year',
      mapThemeId: 'lunar-new-year',
      radioTags: [],
      cubeModel: null,
    },
    dated: { firstDays: LUNAR_NEW_YEAR_FIRST_DAYS, days: 7 },
  },
  {
    holiday: {
      id: 'pride',
      label: 'Pride',
      mapThemeId: 'pride',
      radioTags: ['pride'],
      cubeModel: null,
    },
    annual: { first: { month: 5, day: 1 }, last: { month: 5, day: 30 } },
  },
]

export const SEASONAL_HOLIDAYS: readonly SeasonalHoliday[] = HOLIDAY_WINDOWS.map(window => window.holiday)

function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

function dayOf(year: number, { month, day }: MonthDay): number {
  return Date.UTC(year, month, day) / 86_400_000
}

function windowContains(window: HolidayWindow, now: Date): boolean {
  const today = localDay(now)
  const year = now.getFullYear()
  if (window.annual) {
    return today >= dayOf(year, window.annual.first) && today <= dayOf(year, window.annual.last)
  }
  if (window.dated) {
    // A window starting late in the previous year may still be running.
    return [year, year - 1].some(start => {
      const first = window.dated!.firstDays[start]
      if (!first) return false
      const firstDay = dayOf(start, first)
      return today >= firstDay && today < firstDay + window.dated!.days
    })
  }
  return false
}

// `?holiday=christmas` (or `none`) pins the calendar for previews and demo
// takes; the real date decides everywhere else.
function holidayOverride(): SeasonalHoliday | null | undefined {
  if (typeof window === 'undefined') return undefined
  let value: string | null = null
  try { value = new URLSearchParams(window.location.search).get('holiday') } catch { return undefined }
  if (value === null) return undefined
  if (value === 'none') return null
  return SEASONAL_HOLIDAYS.find(holiday => holiday.id === value)
}

/** The holiday the phone's local date falls in, or null on an ordinary day. */
export function activeHoliday(now?: Date): SeasonalHoliday | null {
  if (!now) {
    const override = holidayOverride()
    if (override !== undefined) return override
  }
  const date = now ?? new Date()
  return HOLIDAY_WINDOWS.find(window => windowContains(window, date))?.holiday ?? null
}
