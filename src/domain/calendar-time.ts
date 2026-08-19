const SEARCH_MARGIN_MS = 48 * 60 * 60 * 1000
const monthFormatters = new Map<string, Intl.DateTimeFormat>()
const monthEndCache = new Map<string, number>()

export function calendarMonthInTimeZone(timestamp: number, timeZone: string): string {
  if (!Number.isFinite(timestamp)) throw new RangeError(`Invalid timestamp: ${String(timestamp)}`)
  const parts = monthFormatter(timeZone).formatToParts(timestamp)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new RangeError(`Cannot resolve calendar month in time zone: ${timeZone}`)
  return `${year}-${month}`
}

export function calendarMonthEnd(bucket: string, timeZone: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(bucket)
  if (!match) throw new RangeError(`Invalid calendar month: ${bucket}`)
  monthFormatter(timeZone)
  const cacheKey = `${timeZone}\n${bucket}`
  const cached = monthEndCache.get(cacheKey)
  if (cached !== undefined) return cached

  const year = Number(match[1])
  const month = Number(match[2])
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const target = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
  const nominalUtc = Date.UTC(nextYear, nextMonth - 1, 1)
  let low = nominalUtc - SEARCH_MARGIN_MS
  let high = nominalUtc + SEARCH_MARGIN_MS

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (calendarMonthInTimeZone(middle, timeZone) < target) low = middle + 1
    else high = middle
  }
  if (calendarMonthInTimeZone(low, timeZone) !== target) {
    throw new RangeError(`Cannot resolve start of ${target} in time zone: ${timeZone}`)
  }
  const cutoff = low - 1
  monthEndCache.set(cacheKey, cutoff)
  return cutoff
}

function monthFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = monthFormatters.get(timeZone)
  if (cached) return cached
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    })
    formatter.format(0)
    monthFormatters.set(timeZone, formatter)
    return formatter
  } catch {
    throw new RangeError(`Invalid time zone: ${timeZone}`)
  }
}
