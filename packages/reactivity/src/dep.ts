import { extend, isArray, isIntegerKey, isMap, isSymbol } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import { type TrackOpTypes, TriggerOpTypes } from './constants'
import {
  type DebuggerEventExtraInfo,
  EffectFlags,
  type Subscriber,
  activeSub,
  endBatch,
  shouldTrack,
  startBatch,
} from './effect'

/**
 * 每次发生响应式变化时递增
 * 这用于为 computed 提供快速路径，以在没有任何变化时避免重新计算。
 */
export let globalVersion = 0

/**
 * 表示源（Dep）和订阅者（Effect 或 Computed）之间的链接。
 * Deps 和 subs 是多对多关系 - dep 和 sub 之间的每个链接都由一个 Link 实例表示。
 *
 * Link 也是两个双向链表中的节点 - 一个用于关联的 sub 追踪其所有依赖，
 * 另一个用于关联的 dep 追踪其所有订阅者。
 *
 * @internal
 */
export class Link {
  /**
   * - 在每次 effect 运行之前，所有先前的 dep 链接的版本都会重置为 -1
   * - 在运行期间，链接的版本在访问时与源 dep 同步
   * - 运行后，版本为 -1 的链接（从未使用的）会被清理
   */
  version: number

  /**
   * 双向链表的指针
   */
  nextDep?: Link
  prevDep?: Link
  nextSub?: Link
  prevSub?: Link
  prevActiveLink?: Link

  constructor(
    public sub: Subscriber,
    public dep: Dep,
  ) {
    this.version = dep.version
    this.nextDep =
      this.prevDep =
      this.nextSub =
      this.prevSub =
      this.prevActiveLink =
        undefined
  }
}

/**
 * @internal
 */
export class Dep {
  version = 0
  /**
   * 此 dep 与当前活动 effect 之间的链接
   */
  activeLink?: Link = undefined

  /**
   * 表示订阅 effects 的双向链表（尾部）
   */
  subs?: Link = undefined

  /**
   * 表示订阅 effects 的双向链表（头部）
   * 仅开发环境，用于按正确顺序调用 onTrigger 钩子
   */
  subsHead?: Link

  /**
   * 用于对象属性依赖清理
   */
  map?: KeyToDepMap = undefined
  key?: unknown = undefined

  /**
   * 订阅者计数器
   */
  sc: number = 0

  /**
   * @internal
   */
  readonly __v_skip = true
  // TODO isolatedDeclarations ReactiveFlags.SKIP

  constructor(public computed?: ComputedRefImpl | undefined) {
    if (__DEV__) {
      this.subsHead = undefined
    }
  }

  track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return
    }

    let link = this.activeLink
    if (link === undefined || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this)

      // add the link to the activeEffect as a dep (as tail)
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
      }

      addSub(link)
    } else if (link.version === -1) {
      // 从上次运行重用 - 已经是一个 sub，只需同步版本
      link.version = this.version

      // 如果此 dep 有 next，这意味着它不在尾部 - 将其移动到
      // 尾部。这确保了 effect 的依赖列表按照它们在评估期间
      // 被访问的顺序排列。
      if (link.nextDep) {
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
          link.prevDep.nextDep = next
        }

        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        // 这是头部 - 指向新的头部
        if (activeSub.deps === link) {
          activeSub.deps = next
        }
      }
    }

    if (__DEV__ && activeSub.onTrack) {
      activeSub.onTrack(
        extend(
          {
            effect: activeSub,
          },
          debugInfo,
        ),
      )
    }

    return link
  }

  trigger(debugInfo?: DebuggerEventExtraInfo): void {
    this.version++
    globalVersion++
    this.notify(debugInfo)
  }

  notify(debugInfo?: DebuggerEventExtraInfo): void {
    startBatch()
    try {
      if (__DEV__) {
        // subs 以反向顺序被通知和批处理，然后在批处理结束时以原始顺序调用，
        // 但 onTrigger 钩子应该在这里以原始顺序调用。
        for (let head = this.subsHead; head; head = head.nextSub) {
          if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
            head.sub.onTrigger(
              extend(
                {
                  effect: head.sub,
                },
                debugInfo,
              ),
            )
          }
        }
      }
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.notify()) {
          // 如果 notify() 返回 `true`，这是一个 computed。还要调用
          // 其 dep 的 notify - 在这里调用而不是在 computed 的 notify 内部调用
          // 以减少调用栈深度。
          ;(link.sub as ComputedRefImpl).dep.notify()
        }
      }
    } finally {
      endBatch()
    }
  }
}

function addSub(link: Link) {
  link.dep.sc++
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed
    // computed 获得它的第一个订阅者
    // 启用追踪 + 懒订阅其所有依赖
    if (computed && !link.dep.subs) {
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l)
      }
    }

    const currentTail = link.dep.subs
    if (currentTail !== link) {
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link
    }

    if (__DEV__ && link.dep.subsHead === undefined) {
      link.dep.subsHead = link
    }

    link.dep.subs = link
  }
}

// 存储目标 {target -> key -> dep} 连接的主要 WeakMap。
// 从概念上讲，将依赖视为维护一组订阅者的 Dep 类更容易理解，
// 但我们只是将它们存储为原始 Maps 以减少内存开销。
type KeyToDepMap = Map<any, Dep>

export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

export const ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Object iterate' : '',
)
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Map keys iterate' : '',
)
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Array iterate' : '',
)

/**
 * 追踪对响应式属性的访问。
 *
 * 这将检查当前正在运行的 effect 并将其记录为 dep，
 * dep 记录所有依赖于响应式属性的 effects。
 *
 * @param target - 持有响应式属性的对象。
 * @param type - 定义对响应式属性的访问类型。
 * @param key - 要追踪的响应式属性的标识符。
 */
export function track(target: object, type: TrackOpTypes, key: unknown): void {
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Dep()))
      dep.map = depsMap
      dep.key = key
    }
    if (__DEV__) {
      dep.track({
        target,
        type,
        key,
      })
    } else {
      dep.track()
    }
  }
}

/**
 * 查找与目标（或特定属性）关联的所有依赖并触发其中存储的 effects。
 *
 * @param target - 响应式对象。
 * @param type - 定义需要触发 effects 的操作类型。
 * @param key - 可用于定位目标对象中的特定响应式属性。
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>,
): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // 从未被追踪
    globalVersion++
    return
  }

  const run = (dep: Dep | undefined) => {
    if (dep) {
      if (__DEV__) {
        dep.trigger({
          target,
          type,
          key,
          newValue,
          oldValue,
          oldTarget,
        })
      } else {
        dep.trigger()
      }
    }
  }

  startBatch()

  if (type === TriggerOpTypes.CLEAR) {
    // 正在清除集合
    // 触发目标的所有 effects
    depsMap.forEach(run)
  } else {
    const targetIsArray = isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    if (targetIsArray && key === 'length') {
      const newLength = Number(newValue)
      depsMap.forEach((dep, key) => {
        if (
          key === 'length' ||
          key === ARRAY_ITERATE_KEY ||
          (!isSymbol(key) && key >= newLength)
        ) {
          run(dep)
        }
      })
    } else {
      // 为 SET | ADD | DELETE 安排运行
      if (key !== void 0 || depsMap.has(void 0)) {
        run(depsMap.get(key))
      }

      // 为任何数字键变化安排 ARRAY_ITERATE（长度已在上面处理）
      if (isArrayIndex) {
        run(depsMap.get(ARRAY_ITERATE_KEY))
      }

      // 为 ADD | DELETE | Map.SET 上的迭代键运行
      switch (type) {
        case TriggerOpTypes.ADD:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          } else if (isArrayIndex) {
            // 新索引添加到数组 -> 长度变化
            run(depsMap.get('length'))
          }
          break
        case TriggerOpTypes.DELETE:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          }
          break
        case TriggerOpTypes.SET:
          if (isMap(target)) {
            run(depsMap.get(ITERATE_KEY))
          }
          break
      }
    }
  }

  endBatch()
}

export function getDepFromReactive(
  object: any,
  key: string | number | symbol,
): Dep | undefined {
  const depMap = targetMap.get(object)
  return depMap && depMap.get(key)
}
