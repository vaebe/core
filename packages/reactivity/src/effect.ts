import { extend, hasChanged } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'
import { type Link, globalVersion } from './dep'
import { activeEffectScope } from './effectScope'
import { warn } from './warning'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: Subscriber
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  scheduler?: EffectScheduler
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export let activeSub: Subscriber | undefined

export enum EffectFlags {
  /**
   * 仅 ReactiveEffect
   */
  ACTIVE = 1 << 0,
  RUNNING = 1 << 1,
  TRACKING = 1 << 2,
  NOTIFIED = 1 << 3,
  DIRTY = 1 << 4,
  ALLOW_RECURSE = 1 << 5,
  PAUSED = 1 << 6,
  EVALUATED = 1 << 7,
}

/**
 * Subscriber 是一种追踪（或订阅）依赖列表的类型。
 */
export interface Subscriber extends DebuggerOptions {
  /**
   * 表示依赖的双向链表的头部
   * @internal
   */
  deps?: Link
  /**
   * 同一个列表的尾部
   * @internal
   */
  depsTail?: Link
  /**
   * @internal
   */
  flags: EffectFlags
  /**
   * @internal
   */
  next?: Subscriber
  /**
   * 返回 `true` 表示这是一个 computed，还需要调用其 dep 的 notify
   * @internal
   */
  notify(): true | void
}

const pausedQueueEffects = new WeakSet<ReactiveEffect>()

export class ReactiveEffect<T = any>
  implements Subscriber, ReactiveEffectOptions
{
  /**
   * @internal
   */
  deps?: Link = undefined
  /**
   * @internal
   */
  depsTail?: Link = undefined
  /**
   * @internal
   */
  flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
  /**
   * @internal
   */
  next?: Subscriber = undefined
  /**
   * @internal
   */
  cleanup?: () => void = undefined

  scheduler?: EffectScheduler = undefined
  onStop?: () => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void

  constructor(public fn: () => T) {
    if (activeEffectScope && activeEffectScope.active) {
      activeEffectScope.effects.push(this)
    }
  }

  pause(): void {
    this.flags |= EffectFlags.PAUSED
  }

  resume(): void {
    if (this.flags & EffectFlags.PAUSED) {
      this.flags &= ~EffectFlags.PAUSED
      if (pausedQueueEffects.has(this)) {
        pausedQueueEffects.delete(this)
        this.trigger()
      }
    }
  }

  /**
   * @internal
   */
  notify(): void {
    if (
      this.flags & EffectFlags.RUNNING &&
      !(this.flags & EffectFlags.ALLOW_RECURSE)
    ) {
      return
    }
    if (!(this.flags & EffectFlags.NOTIFIED)) {
      batch(this)
    }
  }

  run(): T {
    // TODO cleanupEffect

    if (!(this.flags & EffectFlags.ACTIVE)) {
      // 在清理期间停止
      return this.fn()
    }

    this.flags |= EffectFlags.RUNNING
    cleanupEffect(this)
    prepareDeps(this)
    const prevEffect = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = this
    shouldTrack = true

    try {
      return this.fn()
    } finally {
      if (__DEV__ && activeSub !== this) {
        warn(
          'Active effect was not restored correctly - ' +
            'this is likely a Vue internal bug.',
        )
      }
      cleanupDeps(this)
      activeSub = prevEffect
      shouldTrack = prevShouldTrack
      this.flags &= ~EffectFlags.RUNNING
    }
  }

  stop(): void {
    if (this.flags & EffectFlags.ACTIVE) {
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link)
      }
      this.deps = this.depsTail = undefined
      cleanupEffect(this)
      this.onStop && this.onStop()
      this.flags &= ~EffectFlags.ACTIVE
    }
  }

  trigger(): void {
    if (this.flags & EffectFlags.PAUSED) {
      pausedQueueEffects.add(this)
    } else if (this.scheduler) {
      this.scheduler()
    } else {
      this.runIfDirty()
    }
  }

  /**
   * @internal
   */
  runIfDirty(): void {
    if (isDirty(this)) {
      this.run()
    }
  }

  get dirty(): boolean {
    return isDirty(this)
  }
}

/**
 * 用于调试
 */
// function printDeps(sub: Subscriber) {
//   let d = sub.deps
//   let ds = []
//   while (d) {
//     ds.push(d)
//     d = d.nextDep
//   }
//   return ds.map(d => ({
//     id: d.id,
//     prev: d.prevDep?.id,
//     next: d.nextDep?.id,
//   }))
// }

let batchDepth = 0
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

export function batch(sub: Subscriber, isComputed = false): void {
  sub.flags |= EffectFlags.NOTIFIED
  if (isComputed) {
    sub.next = batchedComputed
    batchedComputed = sub
    return
  }
  sub.next = batchedSub
  batchedSub = sub
}

/**
 * @internal
 */
export function startBatch(): void {
  batchDepth++
}

/**
 * 当所有批处理结束时运行批处理的 effects
 * @internal
 */
export function endBatch(): void {
  if (--batchDepth > 0) {
    return
  }

  if (batchedComputed) {
    let e: Subscriber | undefined = batchedComputed
    batchedComputed = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      e = next
    }
  }

  let error: unknown
  while (batchedSub) {
    let e: Subscriber | undefined = batchedSub
    batchedSub = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      if (e.flags & EffectFlags.ACTIVE) {
        try {
          // ACTIVE flag is effect-only
          ;(e as ReactiveEffect).trigger()
        } catch (err) {
          if (!error) error = err
        }
      }
      e = next
    }
  }

  if (error) throw error
}

function prepareDeps(sub: Subscriber) {
  // 准备依赖以进行追踪，从头部开始
  for (let link = sub.deps; link; link = link.nextDep) {
    // 将所有先前依赖（如果有）的版本设置为 -1，以便我们可以追踪
    // 哪些在运行后未被使用
    link.version = -1
    // 如果链接在另一个上下文中被使用，则存储先前的活动 sub
    link.prevActiveLink = link.dep.activeLink
    link.dep.activeLink = link
  }
}

function cleanupDeps(sub: Subscriber) {
  // 清理未使用的依赖
  let head
  let tail = sub.depsTail
  let link = tail
  while (link) {
    const prev = link.prevDep
    if (link.version === -1) {
      if (link === tail) tail = prev
      // unused - remove it from the dep's subscribing effect list
      removeSub(link)
      // also remove it from this effect's dep list
      removeDep(link)
    } else {
      // 新的头部是看到的最后一个未被删除的节点
      // 从双向链表中
      head = link
    }

    // 如果有的话，恢复先前的活动链接
    link.dep.activeLink = link.prevActiveLink
    link.prevActiveLink = undefined
    link = prev
  }
  // 设置新的头部和尾部
  sub.deps = head
  sub.depsTail = tail
}

function isDirty(sub: Subscriber): boolean {
  for (let link = sub.deps; link; link = link.nextDep) {
    if (
      link.dep.version !== link.version ||
      (link.dep.computed &&
        (refreshComputed(link.dep.computed) ||
          link.dep.version !== link.version))
    ) {
      return true
    }
  }
  // @ts-expect-error 仅用于向后兼容，库手动设置
  // 此标志 - 例如 Pinia 的测试模块
  if (sub._dirty) {
    return true
  }
  return false
}

/**
 * 返回 false 表示刷新失败
 * @internal
 */
export function refreshComputed(computed: ComputedRefImpl): undefined {
  if (
    computed.flags & EffectFlags.TRACKING &&
    !(computed.flags & EffectFlags.DIRTY)
  ) {
    return
  }
  computed.flags &= ~EffectFlags.DIRTY

  // 自上次刷新以来未发生响应式更改时的全局版本快速路径。
  if (computed.globalVersion === globalVersion) {
    return
  }
  computed.globalVersion = globalVersion

  // 在 SSR 中不会有渲染 effect，所以 computed 没有订阅者
  // 因此不追踪任何依赖，所以我们不能依赖脏检查。
  // 相反，computed 总是重新评估并依赖于上面的 globalVersion
  // 快速路径进行缓存。
  // #12337 如果 computed 没有依赖（不依赖任何响应式数据）并且已评估，
  // 则无需重新评估。
  if (
    !computed.isSSR &&
    computed.flags & EffectFlags.EVALUATED &&
    ((!computed.deps && !(computed as any)._dirty) || !isDirty(computed))
  ) {
    return
  }
  computed.flags |= EffectFlags.RUNNING

  const dep = computed.dep
  const prevSub = activeSub
  const prevShouldTrack = shouldTrack
  activeSub = computed
  shouldTrack = true

  try {
    prepareDeps(computed)
    const value = computed.fn(computed._value)
    if (dep.version === 0 || hasChanged(value, computed._value)) {
      computed.flags |= EffectFlags.EVALUATED
      computed._value = value
      dep.version++
    }
  } catch (err) {
    dep.version++
    throw err
  } finally {
    activeSub = prevSub
    shouldTrack = prevShouldTrack
    cleanupDeps(computed)
    computed.flags &= ~EffectFlags.RUNNING
  }
}

function removeSub(link: Link, soft = false) {
  const { dep, prevSub, nextSub } = link
  if (prevSub) {
    prevSub.nextSub = nextSub
    link.prevSub = undefined
  }
  if (nextSub) {
    nextSub.prevSub = prevSub
    link.nextSub = undefined
  }
  if (__DEV__ && dep.subsHead === link) {
    // was previous head, point new head to next
    dep.subsHead = nextSub
  }

  if (dep.subs === link) {
    // 是先前的尾部，将新的尾部指向 prev
    dep.subs = prevSub

    if (!prevSub && dep.computed) {
      // 如果是 computed，从其所有依赖中取消订阅，以便这个 computed 及其
      // 值可以被垃圾回收
      dep.computed.flags &= ~EffectFlags.TRACKING
      for (let l = dep.computed.deps; l; l = l.nextDep) {
        // 这里我们只是"软"取消订阅，因为 computed 仍然保持
        // 引用依赖，并且 dep 不应该减少其 sub 计数
        removeSub(l, true)
      }
    }
  }

  if (!soft && !--dep.sc && dep.map) {
    // #11979
    // 属性依赖不再有 effect 订阅者，删除它
    // 这主要用于对象保留在内存中但一次只追踪其属性子集的情况
    dep.map.delete(dep.key)
  }
}

function removeDep(link: Link) {
  const { prevDep, nextDep } = link
  if (prevDep) {
    prevDep.nextDep = nextDep
    link.prevDep = undefined
  }
  if (nextDep) {
    nextDep.prevDep = prevDep
    link.nextDep = undefined
  }
}

export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const e = new ReactiveEffect(fn)
  if (options) {
    extend(e, options)
  }
  try {
    e.run()
  } catch (err) {
    e.stop()
    throw err
  }
  const runner = e.run.bind(e) as ReactiveEffectRunner
  runner.effect = e
  return runner
}

/**
 * 停止与给定 runner 关联的 effect。
 *
 * @param runner - 与要停止追踪的 effect 的关联。
 */
export function stop(runner: ReactiveEffectRunner): void {
  runner.effect.stop()
}

/**
 * @internal
 */
export let shouldTrack = true
const trackStack: boolean[] = []

/**
 * 暂时暂停追踪。
 */
export function pauseTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * 重新启用 effect 追踪（如果已暂停）。
 */
export function enableTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

/**
 * 重置先前的全局 effect 追踪状态。
 */
export function resetTracking(): void {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 为当前活动 effect 注册清理函数。
 * 清理函数在下一次 effect 运行之前或 effect 停止时被调用。
 *
 * 如果没有当前活动 effect，则抛出警告。可以通过将 `true` 传递给第二个参数来抑制警告。
 *
 * @param fn - 要注册的清理函数
 * @param failSilently - 如果为 `true`，则在没有活动 effect 时调用时不会抛出警告。
 */
export function onEffectCleanup(fn: () => void, failSilently = false): void {
  if (activeSub instanceof ReactiveEffect) {
    activeSub.cleanup = fn
  } else if (__DEV__ && !failSilently) {
    warn(
      `onEffectCleanup() was called when there was no active effect` +
        ` to associate with.`,
    )
  }
}

function cleanupEffect(e: ReactiveEffect) {
  const { cleanup } = e
  e.cleanup = undefined
  if (cleanup) {
    // 在没有活动 effect 的情况下运行清理
    const prevSub = activeSub
    activeSub = undefined
    try {
      cleanup()
    } finally {
      activeSub = prevSub
    }
  }
}
