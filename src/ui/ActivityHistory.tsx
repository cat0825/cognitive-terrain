import { useMemo, useState } from 'react'

export interface ActivityHistoryBucket {
  key: string
  label: string
  openedCount: number
  editedCount: number
  reviewedCount: number
  totalCount: number
}

interface ActivityHistoryProps {
  daily: readonly ActivityHistoryBucket[]
  weekly: readonly ActivityHistoryBucket[]
}

type ActivityHistoryRange = 'daily' | 'weekly'

export function ActivityHistory({ daily, weekly }: ActivityHistoryProps) {
  const [range, setRange] = useState<ActivityHistoryRange>('daily')
  const buckets = range === 'daily' ? daily : weekly
  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((bucket) => bucket.totalCount)),
    [buckets],
  )

  return (
    <section className="activity-history" aria-label="活动历史">
      <div className="activity-history__header">
        <span>活动历史</span>
        <div className="activity-history__range" aria-label="活动历史粒度">
          <button
            type="button"
            className={range === 'daily' ? 'is-active' : undefined}
            aria-pressed={range === 'daily'}
            onClick={() => setRange('daily')}
          >
            日
          </button>
          <button
            type="button"
            className={range === 'weekly' ? 'is-active' : undefined}
            aria-pressed={range === 'weekly'}
            onClick={() => setRange('weekly')}
          >
            周
          </button>
        </div>
      </div>
      {buckets.length > 0 ? (
        <div className="activity-history__scroll" tabIndex={0} aria-label={`${range === 'daily' ? '每日' : '每周'}活动柱状图`}>
          <ol className="activity-history__chart">
            {buckets.map((bucket) => (
              <ActivityHistoryBar key={bucket.key} bucket={bucket} maxCount={maxCount} />
            ))}
          </ol>
        </div>
      ) : (
        <small className="activity-history__empty">该时间范围内尚无活动</small>
      )}
      <div className="activity-history__legend" aria-hidden="true">
        <span className="is-opened">打开</span>
        <span className="is-edited">编辑</span>
        <span className="is-reviewed">复习</span>
      </div>
    </section>
  )
}

function ActivityHistoryBar({ bucket, maxCount }: { bucket: ActivityHistoryBucket; maxCount: number }) {
  const height = `${Math.max(8, bucket.totalCount / maxCount * 100)}%`
  const label = `${bucket.label}：共 ${bucket.totalCount} 次，打开 ${bucket.openedCount} 次，编辑 ${bucket.editedCount} 次，复习 ${bucket.reviewedCount} 次`
  const trackedCount = bucket.openedCount + bucket.editedCount + bucket.reviewedCount

  return (
    <li className="activity-history__bucket" aria-label={label} title={label}>
      <span className="activity-history__count" aria-hidden="true">{bucket.totalCount || ''}</span>
      <span className="activity-history__bar" style={{ height }} aria-hidden="true">
        {trackedCount > 0 && (
          <>
            <i className="is-reviewed" style={{ flexGrow: bucket.reviewedCount }} />
            <i className="is-edited" style={{ flexGrow: bucket.editedCount }} />
            <i className="is-opened" style={{ flexGrow: bucket.openedCount }} />
          </>
        )}
      </span>
      <small aria-hidden="true">{bucket.label}</small>
    </li>
  )
}