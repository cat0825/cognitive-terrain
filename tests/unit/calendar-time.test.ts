import { describe, expect, it } from 'vitest'
import { calendarMonthEnd, calendarMonthInTimeZone } from '../../src/domain/calendar-time'

describe('calendar time', () => {
  it('uses the project time zone for positive and negative UTC offsets', () => {
    expect(new Date(calendarMonthEnd('2026-08', 'Asia/Shanghai')).toISOString())
      .toBe('2026-08-31T15:59:59.999Z')
    expect(new Date(calendarMonthEnd('2026-08', 'America/Los_Angeles')).toISOString())
      .toBe('2026-09-01T06:59:59.999Z')
  })

  it('resolves month boundaries across daylight-saving changes', () => {
    expect(new Date(calendarMonthEnd('2026-02', 'America/New_York')).toISOString())
      .toBe('2026-03-01T04:59:59.999Z')
    expect(new Date(calendarMonthEnd('2026-10', 'America/New_York')).toISOString())
      .toBe('2026-11-01T03:59:59.999Z')
  })

  it('uses the same month semantics for bucketing and cutoffs', () => {
    const cutoff = calendarMonthEnd('2026-08', 'Asia/Shanghai')
    expect(calendarMonthInTimeZone(cutoff, 'Asia/Shanghai')).toBe('2026-08')
    expect(calendarMonthInTimeZone(cutoff + 1, 'Asia/Shanghai')).toBe('2026-09')
  })

  it('rejects invalid buckets and time zones', () => {
    expect(() => calendarMonthEnd('2026-13', 'UTC')).toThrow(/Invalid calendar month/)
    expect(() => calendarMonthEnd('2026-08', 'Mars/Olympus')).toThrow(/Invalid time zone/)
  })
})
