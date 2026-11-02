import { getCurrentInstance, onUnmounted, ref } from 'vue'

/**
 * Wraps a function so repeated calls collapse into one, `delay` ms after the
 * last of them.
 *
 * `pending` is set on the *first* call rather than when the wrapped function
 * finally runs, so a caller can show a busy state that covers the wait as well
 * as the work — the two are indistinguishable to whoever is looking at the
 * screen. It is cleared once the call has been made, which for a synchronous
 * function means the work is done too.
 *
 * The timer is cancelled when the owning component unmounts, so a queued call
 * cannot fire against a torn-down scope. Guarded by `getCurrentInstance` because
 * the same debounce is useful in a Pinia setup store, which has no instance to
 * hang the hook on and would only warn.
 */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const pending = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending.value = false
  }

  function schedule(...args: A) {
    if (timer !== null) clearTimeout(timer)
    pending.value = true
    timer = setTimeout(() => {
      timer = null
      // Cleared before the call, so the wrapped function stays free to set a
      // busy flag of its own without this one overwriting it afterwards.
      pending.value = false
      fn(...args)
    }, delay)
  }

  if (getCurrentInstance()) onUnmounted(cancel)

  return { schedule, cancel, pending }
}
