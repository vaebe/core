import { def, hasOwn, isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers,
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers,
} from './collectionHandlers'
import type { RawSymbol, Ref, UnwrapRefSimple } from './ref'
import { ReactiveFlags } from './constants'
import { warn } from './warning'

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
}

export const reactiveMap: WeakMap<Target, any> = new WeakMap<Target, any>()
export const shallowReactiveMap: WeakMap<Target, any> = new WeakMap<
  Target,
  any
>()
export const readonlyMap: WeakMap<Target, any> = new WeakMap<Target, any>()
export const shallowReadonlyMap: WeakMap<Target, any> = new WeakMap<
  Target,
  any
>()

enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2,
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// 仅解包嵌套的 ref
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

declare const ReactiveMarkerSymbol: unique symbol

export interface ReactiveMarker {
  [ReactiveMarkerSymbol]?: void
}

export type Reactive<T> = UnwrapNestedRefs<T> &
  (T extends readonly any[] ? ReactiveMarker : {})

/**
 * 返回对象的响应式代理。
 *
 * 响应式转换是"深度"的：它影响所有嵌套属性。响应式对象还会深度解包任何 ref 属性，
 * 同时保持响应性。
 *
 * @example
 * ```js
 * const obj = reactive({ count: 0 })
 * ```
 *
 * @param target - 源对象。
 * @see {@link https://vuejs.org/api/reactivity-core.html#reactive}
 */
export function reactive<T extends object>(target: T): Reactive<T>
/*@__NO_SIDE_EFFECTS__*/
export function reactive(target: object) {
  // 如果尝试观察一个只读代理，返回只读版本。
  if (isReadonly(target)) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap,
  )
}

export declare const ShallowReactiveMarker: unique symbol

export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }

/**
 * {@link reactive} 的浅层版本。
 *
 * 与 {@link reactive} 不同，没有深度转换：只有根级属性对于浅层响应式对象是响应式的。
 * 属性值按原样存储和暴露 - 这也意味着具有 ref 值的属性不会自动解包。
 *
 * @example
 * ```js
 * const state = shallowReactive({
 *   foo: 1,
 *   nested: {
 *     bar: 2
 *   }
 * })
 *
 * // 修改 state 自己的属性是响应式的
 * state.foo++
 *
 * // ...但不转换嵌套对象
 * isReactive(state.nested) // false
 *
 * // 不是响应式的
 * state.nested.bar++
 * ```
 *
 * @param target - 源对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowreactive}
 */
/*@__NO_SIDE_EFFECTS__*/
export function shallowReactive<T extends object>(
  target: T,
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap,
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
export type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends Ref<infer U, unknown>
                  ? Readonly<Ref<DeepReadonly<U>>>
                  : T extends {}
                    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                    : Readonly<T>

/**
 * 接受一个对象（响应式或普通）或一个 ref 并返回原始对象的只读代理。
 *
 * 只读代理是深度的：访问的任何嵌套属性也将是只读的。它还具有与 {@link reactive} 相同的
 * ref 解包行为，只是解包的值也将被设为只读。
 *
 * @example
 * ```js
 * const original = reactive({ count: 0 })
 *
 * const copy = readonly(original)
 *
 * watchEffect(() => {
 *   // 适用于响应性追踪
 *   console.log(copy.count)
 * })
 *
 * // 修改 original 将触发依赖 copy 的 watchers
 * original.count++
 *
 * // 修改 copy 将失败并导致警告
 * copy.count++ // 警告!
 * ```
 *
 * @param target - 源对象。
 * @see {@link https://vuejs.org/api/reactivity-core.html#readonly}
 */
/*@__NO_SIDE_EFFECTS__*/
export function readonly<T extends object>(
  target: T,
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap,
  )
}

/**
 * {@link readonly} 的浅层版本。
 *
 * 与 {@link readonly} 不同，没有深度转换：只有根级属性被设为只读。
 * 属性值按原样存储和暴露 - 这也意味着具有 ref 值的属性不会自动解包。
 *
 * @example
 * ```js
 * const state = shallowReadonly({
 *   foo: 1,
 *   nested: {
 *     bar: 2
 *   }
 * })
 *
 * // 修改 state 自己的属性将失败
 * state.foo++
 *
 * // ...但对嵌套对象有效
 * isReadonly(state.nested) // false
 *
 * // 有效
 * state.nested.bar++
 * ```
 *
 * @param target - 源对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowreadonly}
 */
/*@__NO_SIDE_EFFECTS__*/
export function shallowReadonly<T extends object>(target: T): Readonly<T> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap,
  )
}

function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>,
) {
  if (!isObject(target)) {
    if (__DEV__) {
      warn(
        `value cannot be made ${isReadonly ? 'readonly' : 'reactive'}: ${String(
          target,
        )}`,
      )
    }
    return target
  }
  // target 已经是一个 Proxy，返回它。
  // 例外：在响应式对象上调用 readonly()
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // 只有特定的值类型可以被观察。
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // target 已经有对应的 Proxy
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers,
  )
  proxyMap.set(target, proxy)
  return proxy
}

/**
 * 检查对象是否是由 {@link reactive} 或
 * {@link shallowReactive} 创建的代理（或在某些情况下是 {@link ref}）。
 *
 * @example
 * ```js
 * isReactive(reactive({}))            // => true
 * isReactive(readonly(reactive({})))  // => true
 * isReactive(ref({}).value)           // => true
 * isReactive(readonly(ref({})).value) // => true
 * isReactive(ref(true))               // => false
 * isReactive(shallowRef({}).value)    // => false
 * isReactive(shallowReactive({}))     // => true
 * ```
 *
 * @param value - 要检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isreactive}
 */
/*@__NO_SIDE_EFFECTS__*/
export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

/**
 * 检查传递的值是否是只读对象。只读对象的属性可以更改，
 * 但不能通过传递的对象直接赋值。
 *
 * 由 {@link readonly} 和 {@link shallowReadonly} 创建的代理都被视为只读，
 * 没有设置函数的 computed ref 也是如此。
 *
 * @param value - 要检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isreadonly}
 */
/*@__NO_SIDE_EFFECTS__*/
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

/*@__NO_SIDE_EFFECTS__*/
export function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

/**
 * 检查对象是否是由 {@link reactive}、
 * {@link readonly}、{@link shallowReactive} 或 {@link shallowReadonly} 创建的代理。
 *
 * @param value - 要检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isproxy}
 */
/*@__NO_SIDE_EFFECTS__*/
export function isProxy(value: any): boolean {
  return value ? !!value[ReactiveFlags.RAW] : false
}

/**
 * 返回 Vue 创建的代理的原始对象。
 *
 * `toRaw()` 可以从由 {@link reactive}、{@link readonly}、{@link shallowReactive} 或
 * {@link shallowReadonly} 创建的代理返回原始对象。
 *
 * 这是一个逃生舱，可以用于临时读取而不产生代理访问/追踪开销或写入而不触发更改。
 * **不**建议持有对原始对象的持久引用。请谨慎使用。
 *
 * @example
 * ```js
 * const foo = {}
 * const reactiveFoo = reactive(foo)
 *
 * console.log(toRaw(reactiveFoo) === foo) // true
 * ```
 *
 * @param observed - 请求"原始"值的对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#toraw}
 */
/*@__NO_SIDE_EFFECTS__*/
export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

export type Raw<T> = T & { [RawSymbol]?: true }

/**
 * 标记一个对象，使其永远不会被转换为代理。返回对象本身。
 *
 * @example
 * ```js
 * const foo = markRaw({})
 * console.log(isReactive(reactive(foo))) // false
 *
 * // 当嵌套在其他响应式对象中时也有效
 * const bar = reactive({ foo })
 * console.log(isReactive(bar.foo)) // false
 * ```
 *
 * **警告：** `markRaw()` 与诸如 {@link shallowReactive} 之类的浅层 API 一起
 * 允许您选择性地退出默认的深度响应式/只读转换，并在状态图中嵌入原始的、非代理对象。
 *
 * @param value - 要标记为"原始"的对象。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#markraw}
 */
export function markRaw<T extends object>(value: T): Raw<T> {
  if (!hasOwn(value, ReactiveFlags.SKIP) && Object.isExtensible(value)) {
    def(value, ReactiveFlags.SKIP, true)
  }
  return value
}

/**
 * 返回给定值（如果可能）的响应式代理。
 *
 * 如果给定值不是对象，则返回原始值本身。
 *
 * @param value - 要为其创建响应式代理的值。
 */
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

/**
 * 返回给定值（如果可能）的只读代理。
 *
 * 如果给定值不是对象，则返回原始值本身。
 *
 * @param value - 要为其创建只读代理的值。
 */
export const toReadonly = <T extends unknown>(value: T): DeepReadonly<T> =>
  isObject(value) ? readonly(value) : (value as DeepReadonly<T>)
