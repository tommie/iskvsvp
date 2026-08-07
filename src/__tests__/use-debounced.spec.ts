import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import { useDebounced } from '../composables/useDebounced'

/** Mounts the composable so the unmount cleanup is exercised as it is in use. */
function host<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  let api!: ReturnType<typeof useDebounced<A>>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useDebounced(fn, delay)
        return () => h('div')
      },
    }),
  )
  return { api, wrapper }
}

describe('useDebounced', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('collapses a burst of calls into one, after the last', () => {
    const fn = vi.fn()
    const { api } = host(fn, 100)

    api.schedule()
    vi.advanceTimersByTime(60)
    api.schedule()
    vi.advanceTimersByTime(60)
    // The second call restarted the wait, so the first must not have fired.
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(40)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes the arguments of the call that won', () => {
    const fn = vi.fn()
    const { api } = host<[string]>(fn, 100)

    api.schedule('first')
    api.schedule('last')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledExactlyOnceWith('last')
  })

  it('is pending from the first call until the function runs', () => {
    const fn = vi.fn()
    const { api } = host(fn, 100)

    expect(api.pending.value).toBe(false)
    api.schedule()
    // Pending covers the wait, not just the work: to whoever is looking at the
    // screen the two are the same thing.
    expect(api.pending.value).toBe(true)

    vi.advanceTimersByTime(100)
    expect(api.pending.value).toBe(false)
  })

  it('is no longer pending while the function itself runs, so callers can own the flag', () => {
    let pendingDuringCall: boolean | null = null
    const { api } = host(() => (pendingDuringCall = api.pending.value), 100)

    api.schedule()
    vi.advanceTimersByTime(100)
    expect(pendingDuringCall).toBe(false)
  })

  it('cancel drops the queued call', () => {
    const fn = vi.fn()
    const { api } = host(fn, 100)

    api.schedule()
    api.cancel()
    expect(api.pending.value).toBe(false)

    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not fire against a component that has gone away', () => {
    const fn = vi.fn()
    const { api, wrapper } = host(fn, 100)

    api.schedule()
    wrapper.unmount()
    vi.advanceTimersByTime(1000)

    expect(fn).not.toHaveBeenCalled()
  })

  it('works outside a component, where there is no instance to clean up on', () => {
    const fn = vi.fn()
    const { schedule } = useDebounced(fn, 100)

    schedule()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
