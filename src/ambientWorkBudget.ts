// Decorative motion has an energy budget even while a person keeps touching
// the app. Renewing an idle timeout on every tap permits 100% duty cycle.
// Share the budget with our same-origin map iframe so remounting it cannot
// buy another burst. Direct manipulation and media do not use this budget.
export const AMBIENT_BURST_MS = 3_000
export const AMBIENT_REST_MS = 12_000

export type AmbientBudgetState = { deadline: number; nextAllowedAt: number }

export function requestAmbientBurst(state: AmbientBudgetState, now: number, requestedMs: number): number {
  if (requestedMs <= 0) return 0
  if (now < state.deadline) return Math.min(state.deadline, now + requestedMs)
  if (now < state.nextAllowedAt) return 0
  state.deadline = now + Math.min(AMBIENT_BURST_MS, requestedMs)
  state.nextAllowedAt = state.deadline + AMBIENT_REST_MS
  return state.deadline
}

type BudgetWindow = Window & { __poplurAmbientWorkBudget?: AmbientBudgetState }

export function nativeAmbientDeadline(requestedMs: number): number {
  // Date.now shares a clock across documents; performance.now has a different
  // time origin after each iframe mount. Return a local monotonic deadline.
  let owner = window as BudgetWindow
  try {
    const parent = window.top as BudgetWindow | null
    if (parent && parent.location.origin === window.location.origin) owner = parent
  } catch { /* A cross-origin embed keeps its own bounded budget. */ }
  const budget = owner.__poplurAmbientWorkBudget ??= { deadline: 0, nextAllowedAt: 0 }
  const now = Date.now()
  const deadline = requestAmbientBurst(budget, now, requestedMs)
  return deadline > now ? performance.now() + deadline - now : 0
}
