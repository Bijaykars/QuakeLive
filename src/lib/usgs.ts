import type { UsgsFeed } from '../types'

export const FEED_ALL_DAY =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
export const FEED_ALL_WEEK =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson'

// Plain fetch, no custom headers (avoids CORS preflight). Poll cadence lives in useFeed.
export async function fetchFeed(url: string = FEED_ALL_DAY): Promise<UsgsFeed> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`USGS feed HTTP ${r.status}`)
  return (await r.json()) as UsgsFeed
}
