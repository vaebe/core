import { isFunction } from '@vue/shared'
import { currentInstance } from './component'
import { currentRenderingInstance } from './componentRenderContext'
import { currentApp } from './apiCreateApp'
import { warn } from './warning'

interface InjectionConstraint<T> {}

export type InjectionKey<T> = symbol & InjectionConstraint<T>

/**
 * provide 函数用于提供可注入的依赖
 * @param key - 依赖的键，可以是 symbol、字符串或数字
 * @param value - 要提供的值
 */
export function provide<T, K = InjectionKey<T> | string | number>(
  key: K,
  value: K extends InjectionKey<infer V> ? V : T,
): void {
  if (!currentInstance) {
    if (__DEV__) {
      warn(`provide() can only be used inside setup().`)
    }
  } else {
    /** 官方注释
     * 默认情况下，组件实例继承其父组件的 provides 对象
     * 但当需要提供自己的值时，会创建一个新的 provides 对象
     * 并将父组件的 provides 对象作为原型
     * 这样在 inject 中可以直接查找直接父组件的注入，并让原型链完成剩下的工作
     */

    // 获取当前实例的 provides
    let provides = currentInstance.provides

    // 获取父组件的 provides
    // 这里可能的值是 null or 一个对象
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides

    // 如果一致就表示这是当前组件第一次调用 provide 提供数据
    // 使用 parentProvides 创建一个新的 provides 对象
    // 这样既可以子组件不会修改父组件的 provides，又可以让子组件可以访问父组件的 provides (需要理解 js 原型、对象引用)
    if (parentProvides === provides) {
      // provides 和 currentInstance.provides 指向同一个对象，当修改这个对象的属性时，无论通过哪个引用修改，都会反映在这个对象上
      provides = currentInstance.provides = Object.create(parentProvides)
    }

    // TS 不允许使用 symbol 作为索引类型，所以这里转换为 string
    provides[key as string] = value
  }
}

// 为 inject 函数定义多个重载签名，以支持不同的使用场景
export function inject<T>(key: InjectionKey<T> | string): T | undefined
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T,
  treatDefaultAsFactory?: false,
): T
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T | (() => T),
  treatDefaultAsFactory: true,
): T

/**
 * inject 函数用于注入依赖
 * @param key - 要注入的依赖的键
 * @param defaultValue - 默认值，当找不到注入值时使用
 * @param treatDefaultAsFactory - 是否将默认值作为工厂函数处理
 */
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown,
  treatDefaultAsFactory = false,
) {
  // 获取当前实例，如果在函数式组件中，则回退到 currentRenderingInstance
  const instance = currentInstance || currentRenderingInstance

  // 同时支持通过 app.runWithContext() 查找应用级别的 provides
  if (instance || currentApp) {
    // 确定 provides 来源：
    // 1. 如果存在 currentApp，使用应用上下文的 provides
    // 2. 否则，如果是根组件实例，使用 vnode 的 appContext provides
    // 3. 否则，使用父组件的 provides
    const provides = currentApp
      ? currentApp._context.provides
      : instance
        ? instance.parent == null
          ? instance.vnode.appContext && instance.vnode.appContext.provides
          : instance.parent.provides
        : undefined

    if (provides && (key as string | symbol) in provides) {
      // 如果在 provides 中找到对应的 key，返回其值
      return provides[key as string]
    } else if (arguments.length > 1) {
      // 如果提供了默认值
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? defaultValue.call(instance && instance.proxy) // 如果默认值是工厂函数，则调用它
        : defaultValue // 否则直接返回默认值
    } else if (__DEV__) {
      // 如果既没有获取到对应的 key 的数据又没有默认值控制台抛出警告
      warn(`injection "${String(key)}" not found.`)
    }
  } else if (__DEV__) {
    warn(`inject() can only be used inside setup() or functional components.`)
  }
}

/**
 * 检查是否处于可以使用 inject() 的上下文中
 * 这个函数用于库开发者，帮助他们在内部使用 inject() 时
 * 避免触发警告。例如 vue-router 中的 useRoute()
 */
export function hasInjectionContext(): boolean {
  return !!(currentInstance || currentRenderingInstance || currentApp)
}
