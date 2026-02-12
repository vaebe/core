import {
  type IfAny,
  hasChanged,
  isArray,
  isFunction,
  isIntegerKey,
  isObject,
} from '@vue/shared'
import { Dep, getDepFromReactive } from './dep'
import {
  type Builtin,
  type ShallowReactiveMarker,
  type Target,
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
} from './reactive'
import type { ComputedRef, WritableComputedRef } from './computed'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { warn } from './warning'

declare const RefSymbol: unique symbol
export declare const RawSymbol: unique symbol

export interface Ref<T = any, S = T> {
  get value(): T
  set value(_: S)
  /**
   * 仅类型区分符。
   * 我们需要这个在公共 d.ts 中，但不希望它出现在 IDE 自动完成中，
   * 所以我们使用私有 Symbol。
   */ [RefSymbol]: true
}

/**
 * 检查值是否是 ref 对象。
 *
 * @param r - 要检查的值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#isref}
 */
export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
/*@__NO_SIDE_EFFECTS__*/
export function isRef(r: any): r is Ref {
  return r ? r[ReactiveFlags.IS_REF] === true : false
}

/**
 * 接受一个内部值并返回一个响应式和可变的 ref 对象，
 * 该对象具有一个指向内部值的单个属性 `.value`。
 *
 * @param value - 要包装在 ref 中的对象。
 * @see {@link https://vuejs.org/api/reactivity-core.html#ref}
 */
export function ref<T>(
  value: T,
): [T] extends [Ref] ? IfAny<T, Ref<T>, T> : Ref<UnwrapRef<T>, UnwrapRef<T> | T>
export function ref<T = any>(): Ref<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function ref(value?: unknown) {
  return createRef(value, false)
}

declare const ShallowRefMarker: unique symbol

export type ShallowRef<T = any, S = T> = Ref<T, S> & {
  [ShallowRefMarker]?: true
}

/**
 * {@link ref} 的浅层版本。
 *
 * @example
 * ```js
 * const state = shallowRef({ count: 1 })
 *
 * // 不会触发更改
 * state.value.count = 2
 *
 * // 会触发更改
 * state.value = { count: 2 }
 * ```
 *
 * @param value - 浅层 ref 的"内部值"。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#shallowref}
 */
export function shallowRef<T>(
  value: T,
): Ref extends T
  ? T extends Ref
    ? IfAny<T, ShallowRef<T>, T>
    : ShallowRef<T>
  : ShallowRef<T>
export function shallowRef<T = any>(): ShallowRef<T | undefined>
/*@__NO_SIDE_EFFECTS__*/
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

function createRef(rawValue: unknown, shallow: boolean) {
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue, shallow)
}

/**
 * @internal
 */
class RefImpl<T = any> {
  _value: T
  private _rawValue: T

  dep: Dep = new Dep()

  public readonly [ReactiveFlags.IS_REF] = true
  public readonly [ReactiveFlags.IS_SHALLOW]: boolean = false

  constructor(value: T, isShallow: boolean) {
    this._rawValue = isShallow ? value : toRaw(value)
    this._value = isShallow ? value : toReactive(value)
    this[ReactiveFlags.IS_SHALLOW] = isShallow
  }

  get value() {
    if (__DEV__) {
      this.dep.track({
        target: this,
        type: TrackOpTypes.GET,
        key: 'value',
      })
    } else {
      this.dep.track()
    }
    return this._value
  }

  set value(newValue) {
    const oldValue = this._rawValue
    const useDirectValue =
      this[ReactiveFlags.IS_SHALLOW] ||
      isShallow(newValue) ||
      isReadonly(newValue)
    newValue = useDirectValue ? newValue : toRaw(newValue)
    if (hasChanged(newValue, oldValue)) {
      this._rawValue = newValue
      this._value = useDirectValue ? newValue : toReactive(newValue)
      if (__DEV__) {
        this.dep.trigger({
          target: this,
          type: TriggerOpTypes.SET,
          key: 'value',
          newValue,
          oldValue,
        })
      } else {
        this.dep.trigger()
      }
    }
  }
}

/**
 * 强制触发依赖于浅层 ref 的 effects。这通常在
 * 对浅层 ref 的内部值进行深度修改后使用。
 *
 * @example
 * ```js
 * const shallow = shallowRef({
 *   greet: 'Hello, world'
 * })
 *
 * // 第一次运行时记录一次 "Hello, world"
 * watchEffect(() => {
 *   console.log(shallow.value.greet)
 * })
 *
 * // 这不会触发 effect，因为 ref 是浅层的
 * shallow.value.greet = 'Hello, universe'
 *
 * // 记录 "Hello, universe"
 * triggerRef(shallow)
 * ```
 *
 * @param ref - 其关联的 effects 将被执行的 ref。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#triggerref}
 */
export function triggerRef(ref: Ref): void {
  // ref may be an instance of ObjectRefImpl
  if ((ref as unknown as RefImpl).dep) {
    if (__DEV__) {
      ;(ref as unknown as RefImpl).dep.trigger({
        target: ref,
        type: TriggerOpTypes.SET,
        key: 'value',
        newValue: (ref as unknown as RefImpl)._value,
      })
    } else {
      ;(ref as unknown as RefImpl).dep.trigger()
    }
  }
}

export type MaybeRef<T = any> =
  | T
  | Ref<T>
  | ShallowRef<T>
  | WritableComputedRef<T>

export type MaybeRefOrGetter<T = any> = MaybeRef<T> | ComputedRef<T> | (() => T)

/**
 * 如果参数是 ref，则返回内部值，否则返回参数本身。
 * 这是一个糖函数，用于 `val = isRef(val) ? val.value : val`。
 *
 * @example
 * ```js
 * function useFoo(x: number | Ref<number>) {
 *   const unwrapped = unref(x)
 *   // unwrapped 现在保证是 number
 * }
 * ```
 *
 * @param ref - 要转换为普通值的 ref 或普通值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#unref}
 */
export function unref<T>(ref: MaybeRef<T> | ComputedRef<T>): T {
  return isRef(ref) ? ref.value : ref
}

/**
 * 将值 / ref / getter 标准化为值。
 * 这类似于 {@link unref}，只是它还标准化 getter。
 * 如果参数是 getter，它将被调用并返回其返回值。
 *
 * @example
 * ```js
 * toValue(1) // 1
 * toValue(ref(1)) // 1
 * toValue(() => 1) // 1
 * ```
 *
 * @param source - getter、现有的 ref 或非函数值。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#tovalue}
 */
export function toValue<T>(source: MaybeRefOrGetter<T>): T {
  return isFunction(source) ? source() : unref(source)
}

const shallowUnwrapHandlers: ProxyHandler<any> = {
  get: (target, key, receiver) =>
    key === ReactiveFlags.RAW
      ? target
      : unref(Reflect.get(target, key, receiver)),
  set: (target, key, value, receiver) => {
    const oldValue = target[key]
    if (isRef(oldValue) && !isRef(value)) {
      oldValue.value = value
      return true
    } else {
      return Reflect.set(target, key, value, receiver)
    }
  },
}

/**
 * 返回给定对象的代理，该代理浅层解包是 ref 的属性。
 * 如果对象已经是响应式的，则按原样返回。如果不是，则创建一个新的响应式代理。
 *
 * @param objectWithRefs - 已经是响应式的对象或包含 ref 的简单对象。
 */
export function proxyRefs<T extends object>(
  objectWithRefs: T,
): ShallowUnwrapRef<T> {
  return isReactive(objectWithRefs)
    ? (objectWithRefs as ShallowUnwrapRef<T>)
    : new Proxy(objectWithRefs, shallowUnwrapHandlers)
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void,
) => {
  get: () => T
  set: (value: T) => void
}

class CustomRefImpl<T> {
  public dep: Dep

  private readonly _get: ReturnType<CustomRefFactory<T>>['get']
  private readonly _set: ReturnType<CustomRefFactory<T>>['set']

  public readonly [ReactiveFlags.IS_REF] = true

  public _value: T = undefined!

  constructor(factory: CustomRefFactory<T>) {
    const dep = (this.dep = new Dep())
    const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep))
    this._get = get
    this._set = set
  }

  get value() {
    return (this._value = this._get())
  }

  set value(newVal) {
    this._set(newVal)
  }
}

/**
 * 创建一个自定义 ref，可以显式控制其依赖追踪和更新触发。
 *
 * @param factory - 接收 `track` 和 `trigger` 回调的函数。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#customref}
 */
export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  return new CustomRefImpl(factory) as any
}

export type ToRefs<T = any> = {
  [K in keyof T]: ToRef<T[K]>
}

/**
 * 将响应式对象转换为普通对象，其中结果对象的每个属性都是指向
 * 原始对象相应属性的 ref。每个单独的 ref 都是使用 {@link toRef} 创建的。
 *
 * @param object - 要转换为链接 ref 对象的响应式对象。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#torefs}
 */
/*@__NO_SIDE_EFFECTS__*/
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = isArray(object) ? new Array(object.length) : {}
  for (const key in object) {
    ret[key] = propertyToRef(object, key)
  }
  return ret
}

class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly [ReactiveFlags.IS_REF] = true
  public _value: T[K] = undefined!

  private readonly _raw: T
  private readonly _shallow: boolean

  constructor(
    private readonly _object: T,
    private readonly _key: K,
    private readonly _defaultValue?: T[K],
  ) {
    this._raw = toRaw(_object)

    let shallow = true
    let obj = _object

    // 对于具有整数键的数组，ref 不会解包
    if (!isArray(_object) || !isIntegerKey(String(_key))) {
      // 否则，检查每个代理层以进行解包
      do {
        shallow = !isProxy(obj) || isShallow(obj)
      } while (shallow && (obj = (obj as Target)[ReactiveFlags.RAW]))
    }

    this._shallow = shallow
  }

  get value() {
    let val = this._object[this._key]
    if (this._shallow) {
      val = unref(val)
    }
    return (this._value = val === undefined ? this._defaultValue! : val)
  }

  set value(newVal) {
    if (this._shallow && isRef(this._raw[this._key])) {
      const nestedRef = this._object[this._key]
      if (isRef(nestedRef)) {
        nestedRef.value = newVal
        return
      }
    }

    this._object[this._key] = newVal
  }

  get dep(): Dep | undefined {
    return getDepFromReactive(this._raw, this._key)
  }
}

class GetterRefImpl<T> {
  public readonly [ReactiveFlags.IS_REF] = true
  public readonly [ReactiveFlags.IS_READONLY] = true
  public _value: T = undefined!

  constructor(private readonly _getter: () => T) {}
  get value() {
    return (this._value = this._getter())
  }
}

export type ToRef<T> = IfAny<T, Ref<T>, [T] extends [Ref] ? T : Ref<T>>

/**
 * 用于将值 / ref / getter 标准化为 ref。
 *
 * @example
 * ```js
 * // 按原样返回现有的 ref
 * toRef(existingRef)
 *
 * // 创建一个在 .value 访问时调用 getter 的 ref
 * toRef(() => props.foo)
 *
 * // 从非函数值创建普通 ref
 * // 等同于 ref(1)
 * toRef(1)
 * ```
 *
 * 也可以用于为源响应式对象的属性创建 ref。
 * 创建的 ref 与其源属性同步：修改源属性将更新 ref，反之亦然。
 *
 * @example
 * ```js
 * const state = reactive({
 *   foo: 1,
 *   bar: 2
 * })
 *
 * const fooRef = toRef(state, 'foo')
 *
 * // 修改 ref 会更新原始值
 * fooRef.value++
 * console.log(state.foo) // 2
 *
 * // 修改原始值也会更新 ref
 * state.foo++
 * console.log(fooRef.value) // 3
 * ```
 *
 * @param source - getter、现有的 ref、非函数值或要从中创建属性 ref 的响应式对象。
 * @param [key] - （可选）响应式对象中的属性名称。
 * @see {@link https://vuejs.org/api/reactivity-utilities.html#toref}
 */
export function toRef<T>(
  value: T,
): T extends () => infer R
  ? Readonly<Ref<R>>
  : T extends Ref
    ? T
    : Ref<UnwrapRef<T>>
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
): ToRef<T[K]>
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K,
  defaultValue: T[K],
): ToRef<Exclude<T[K], undefined>>
/*@__NO_SIDE_EFFECTS__*/
export function toRef(
  source: Record<string, any> | MaybeRef,
  key?: string,
  defaultValue?: unknown,
): Ref {
  if (isRef(source)) {
    return source
  } else if (isFunction(source)) {
    return new GetterRefImpl(source) as any
  } else if (isObject(source) && arguments.length > 1) {
    return propertyToRef(source, key!, defaultValue)
  } else {
    return ref(source)
  }
}

function propertyToRef(
  source: Record<string, any>,
  key: string,
  defaultValue?: unknown,
) {
  return new ObjectRefImpl(source, key, defaultValue) as any
}

/**
 * 这是一个特殊的导出接口，供其他包声明应该退出 ref 解包的附加类型。
 * 例如，\@vue/runtime-dom 可以在其 d.ts 中这样声明：
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 */
export interface RefUnwrapBailTypes {}

export type ShallowUnwrapRef<T> = {
  [K in keyof T]: DistributeRef<T[K]>
}

type DistributeRef<T> = T extends Ref<infer V, unknown> ? V : T

export type UnwrapRef<T> =
  T extends ShallowRef<infer V, unknown>
    ? V
    : T extends Ref<infer V, unknown>
      ? UnwrapRefSimple<V>
      : UnwrapRefSimple<T>

export type UnwrapRefSimple<T> = T extends
  | Builtin
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  | { [RawSymbol]?: true }
  ? T
  : T extends Map<infer K, infer V>
    ? Map<K, UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Map<any, any>>>
    : T extends WeakMap<infer K, infer V>
      ? WeakMap<K, UnwrapRefSimple<V>> &
          UnwrapRef<Omit<T, keyof WeakMap<any, any>>>
      : T extends Set<infer V>
        ? Set<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof Set<any>>>
        : T extends WeakSet<infer V>
          ? WeakSet<UnwrapRefSimple<V>> & UnwrapRef<Omit<T, keyof WeakSet<any>>>
          : T extends ReadonlyArray<any>
            ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
            : T extends object & { [ShallowReactiveMarker]?: never }
              ? {
                  [P in keyof T]: P extends symbol ? T[P] : UnwrapRef<T[P]>
                }
              : T
