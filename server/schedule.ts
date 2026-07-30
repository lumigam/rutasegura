const WEEKDAY_BY_NAME: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function localScheduleParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || ''
  return { day: WEEKDAY_BY_NAME[value('weekday')], date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}

/** The instant, in absolute UTC, that "today at `time` in `timezone`" refers to (relative to `baseDate`'s calendar day in that zone). */
export function scheduledInstant(baseDate: Date, timezone: string, time: string): Date {
  const local = localScheduleParts(baseDate, timezone)
  const guess = new Date(`${local.date}T${time}:00.000Z`)
  const guessLocal = localScheduleParts(guess, timezone)
  const [guessHours, guessMinutes] = guessLocal.time.split(':').map(Number)
  const [wantHours, wantMinutes] = time.split(':').map(Number)
  const diffMinutes = (wantHours * 60 + wantMinutes) - (guessHours * 60 + guessMinutes)
  return new Date(guess.getTime() + diffMinutes * 60_000)
}
