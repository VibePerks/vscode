// Ad rotation loop for a single sponsor surface.
//
// The loop MUST keep running even when a serve/patch cycle throws. If it stopped
// on the first transient error the surface would freeze on whatever ad was last
// shown - a stale creative that keeps displaying long after its campaign was
// paused. The backend returns the house ad on the next serve once every campaign
// is paused, but a dead loop never asks again, so the old ad lingers forever
// ("stuck on one ad", and "serves ads even when all campaigns are paused").
// Rotation is therefore self-healing: a failed cycle is logged and the next tick
// is still scheduled, so the surface always re-serves (and refreshes to the house
// ad when inventory dries up) on the configured cadence.

// Fallback rotation cadence (ms) when the backend does not supply a positive
// rotate_seconds (or a cycle fails before we learn the next delay).
export const DEFAULT_ROTATE_MS = 20000

// rotateDelayMs is the delay before the next rotation: the backend-provided
// rotate_seconds (when positive) or the default cadence.
export function rotateDelayMs(rotateSeconds: number | undefined): number {
  return rotateSeconds && rotateSeconds > 0 ? rotateSeconds * 1000 : DEFAULT_ROTATE_MS
}

export type TimerHandle = ReturnType<typeof setTimeout>

// RotationTimers abstracts the timer source so tests can drive rotation
// deterministically instead of waiting on real wall-clock time.
export interface RotationTimers {
  set(fn: () => void, ms: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface RotationHandle {
  stop(): void
}

export interface RotationOptions {
  timers: RotationTimers
  // One rotation: serve + patch the surface, returning the delay (ms) until the
  // next rotation. May throw - the loop recovers and keeps rotating.
  cycle: () => Promise<number>
  // Delay (ms) before the FIRST rotation tick.
  initialDelayMs: number
  // Called with any error thrown by `cycle`; the loop keeps rotating afterwards.
  onError: (err: unknown) => void
  // Gates each tick. When it returns false the loop stops without rescheduling
  // (e.g. the user opted out).
  shouldContinue: () => boolean
}

// startRotation begins the rotation loop and returns a handle to stop it.
export function startRotation(opts: RotationOptions): RotationHandle {
  let handle: TimerHandle | undefined
  let stopped = false

  const schedule = (ms: number): void => {
    if (stopped) return
    handle = opts.timers.set(() => void tick(), ms)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    if (!opts.shouldContinue()) {
      stopped = true
      return
    }
    let delay = DEFAULT_ROTATE_MS
    try {
      delay = await opts.cycle()
    } catch (err) {
      opts.onError(err)
    }
    // Always reschedule (unless stopped/opted-out) so a failed cycle never
    // freezes the surface on a stale ad.
    schedule(delay)
  }

  schedule(opts.initialDelayMs)

  return {
    stop(): void {
      stopped = true
      if (handle !== undefined) opts.timers.clear(handle)
    },
  }
}
