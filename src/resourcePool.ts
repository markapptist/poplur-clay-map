export type PoplurResourceKind = 'camera' | 'media-decoder' | 'analysis'

export interface PoplurResourceLease {
  readonly kind: PoplurResourceKind
  readonly owner: string
  release(): void
}

interface LeaseRecord {
  id: number
  kind: PoplurResourceKind
  owner: string
  priority: number
  onRevoke?: () => void
}

const CAPACITY: Record<PoplurResourceKind, number> = {
  camera: 1,
  'media-decoder': 1,
  analysis: 1,
}

class PoplurResourcePool {
  private nextID = 0
  private leases = new Map<number, LeaseRecord>()

  acquire(
    kind: PoplurResourceKind,
    owner: string,
    options: { priority?: number; onRevoke?: () => void } = {},
  ): PoplurResourceLease | null {
    const priority = options.priority ?? 0
    const occupants = [...this.leases.values()]
      .filter(lease => lease.kind === kind)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)

    if (occupants.length >= CAPACITY[kind]) {
      const victim = occupants[0]
      if (!victim || victim.priority >= priority) return null
      this.revoke(victim)
    }

    const record: LeaseRecord = {
      id: ++this.nextID,
      kind,
      owner,
      priority,
      onRevoke: options.onRevoke,
    }
    this.leases.set(record.id, record)
    this.publishDiagnostics()

    let released = false
    return {
      kind,
      owner,
      release: () => {
        if (released) return
        released = true
        if (this.leases.get(record.id) === record) {
          this.leases.delete(record.id)
          this.publishDiagnostics()
        }
      },
    }
  }

  private revoke(record: LeaseRecord) {
    if (this.leases.get(record.id) !== record) return
    this.leases.delete(record.id)
    record.onRevoke?.()
    this.publishDiagnostics()
  }

  private publishDiagnostics() {
    if (typeof window === 'undefined') return
    const detail = [...this.leases.values()].map(({ kind, owner, priority }) => ({
      kind,
      owner,
      priority,
    }))
    window.dispatchEvent(new CustomEvent('poplur-resource-pool-change', { detail }))
  }
}

export const poplurResourcePool = new PoplurResourcePool()
