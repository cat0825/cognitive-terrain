import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM script shared with CI, no type declarations
import { PERF_BUDGET, assertWithinBudget, collectBudgetViolations } from '../../scripts/perf-budget.mjs'

const healthy = {
  idle: { fps: 120, over33Ms: 0 },
  playback: { fps: 120, over33Ms: 0 },
  orbit: { fps: 120, over33Ms: 0 },
  syntheticScrub: { fps: 120, over33Ms: 0 },
  directStoreScrub: { fps: 120, over33Ms: 0 },
  pointerScrub: { fps: 120, over33Ms: 0 },
}

describe('perf budget', () => {
  it('accepts measurements from a healthy run', () => {
    expect(collectBudgetViolations(healthy)).toEqual([])
  })

  it('fails on a frame-rate regression', () => {
    // The gate previously printed timings without asserting on them, so a
    // regression like this could not fail CI.
    const violations = collectBudgetViolations({ ...healthy, idle: { fps: 8, over33Ms: 0 } })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('idle')
    expect(violations[0]).toContain('below minimum')
  })

  it('fails on dropped frames even when average fps looks acceptable', () => {
    // Sustained average can hide visible stutter, so long frames are budgeted
    // separately.
    const violations = collectBudgetViolations({ ...healthy, orbit: { fps: 120, over33Ms: 99 } })

    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('frames over 33.3ms')
  })

  it('reports every violation rather than stopping at the first', () => {
    const violations = collectBudgetViolations({
      ...healthy,
      idle: { fps: 5, over33Ms: 99 },
      playback: { fps: 5, over33Ms: 99 },
    })

    expect(violations.length).toBeGreaterThanOrEqual(4)
  })

  it('treats a missing or non-numeric measurement as a failure', () => {
    // A scenario that silently stopped being measured must not read as a pass.
    expect(collectBudgetViolations({ idle: healthy.idle })).toContain('playback: missing measurement')
    expect(collectBudgetViolations({ ...healthy, idle: { fps: Number.NaN, over33Ms: 0 } })[0])
      .toContain('not a finite number')
  })

  it('throws with all violations listed, and stays quiet when within budget', () => {
    expect(() => assertWithinBudget({ ...healthy, idle: { fps: 1, over33Ms: 0 } }))
      .toThrow(/性能预算未达标/)
    expect(() => assertWithinBudget(healthy)).not.toThrow()
  })

  it('exposes a positive export-size floor for the gate to assert on', () => {
    expect(PERF_BUDGET.minExportBytes).toBeGreaterThan(0)
    expect(Object.keys(PERF_BUDGET.scenarios)).toEqual(Object.keys(healthy))
  })
})
