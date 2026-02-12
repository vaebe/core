import type { ReactiveEffect } from './effect'
import { warn } from './warning'

export let activeEffectScope: EffectScope | undefined

export class EffectScope {
  /**
   * @internal
   */
  private _active = true
  /**
   * @internal 追踪 `on` 调用，允许多次调用 `on`
   */
  private _on = 0
  /**
   * @internal
   */
  effects: ReactiveEffect[] = []
  /**
   * @internal
   */
  cleanups: (() => void)[] = []

  private _isPaused = false

  /**
   * 仅由未分离的作用域分配
   * @internal
   */
  parent: EffectScope | undefined
  /**
   * 记录未分离的作用域
   * @internal
   */
  scopes: EffectScope[] | undefined
  /**
   * 追踪子作用域在其父作用域的 scopes 数组中的索引以便优化删除
   * @internal
   */
  private index: number | undefined

  readonly __v_skip = true
  // TODO isolatedDeclarations ReactiveFlags.SKIP

  constructor(public detached = false) {
    this.parent = activeEffectScope
    if (!detached && activeEffectScope) {
      this.index =
        (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
          this,
        ) - 1
    }
  }

  get active(): boolean {
    return this._active
  }

  pause(): void {
    if (this._active) {
      this._isPaused = true
      let i, l
      if (this.scopes) {
        for (i = 0, l = this.scopes.length; i < l; i++) {
          this.scopes[i].pause()
        }
      }
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].pause()
      }
    }
  }

  /**
   * 恢复 effect 作用域，包括所有子作用域和 effects。
   */
  resume(): void {
    if (this._active) {
      if (this._isPaused) {
        this._isPaused = false
        let i, l
        if (this.scopes) {
          for (i = 0, l = this.scopes.length; i < l; i++) {
            this.scopes[i].resume()
          }
        }
        for (i = 0, l = this.effects.length; i < l; i++) {
          this.effects[i].resume()
        }
      }
    }
  }

  run<T>(fn: () => T): T | undefined {
    if (this._active) {
      const currentEffectScope = activeEffectScope
      try {
        activeEffectScope = this
        return fn()
      } finally {
        activeEffectScope = currentEffectScope
      }
    } else if (__DEV__) {
      warn(`cannot run an inactive effect scope.`)
    }
  }

  prevScope: EffectScope | undefined
  /**
   * 这应该只在非分离作用域上调用
   * @internal
   */
  on(): void {
    if (++this._on === 1) {
      this.prevScope = activeEffectScope
      activeEffectScope = this
    }
  }

  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off(): void {
    if (this._on > 0 && --this._on === 0) {
      activeEffectScope = this.prevScope
      this.prevScope = undefined
    }
  }

  stop(fromParent?: boolean): void {
    if (this._active) {
      this._active = false
      let i, l
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop()
      }
      this.effects.length = 0

      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]()
      }
      this.cleanups.length = 0

      if (this.scopes) {
        for (i = 0, l = this.scopes.length; i < l; i++) {
          this.scopes[i].stop(true)
        }
        this.scopes.length = 0
      }

      // 嵌套作用域，从父级取消引用以避免内存泄漏
      if (!this.detached && this.parent && !fromParent) {
        // 优化的 O(1) 删除
        const last = this.parent.scopes!.pop()
        if (last && last !== this) {
          this.parent.scopes![this.index!] = last
          last.index = this.index!
        }
      }
      this.parent = undefined
    }
  }
}

/**
 * 创建一个 effect 作用域对象，它可以捕获在其中创建的响应式 effects（即
 * computed 和 watchers），以便这些 effects 可以一起被释放。有关此 API 的详细用例，请查阅其
 * 相应的 {@link https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md | RFC}。
 *
 * @param detached - 可用于创建"分离的" effect 作用域。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#effectscope}
 */
export function effectScope(detached?: boolean): EffectScope {
  return new EffectScope(detached)
}

/**
 * 如果存在当前活动的 effect 作用域，则返回它。
 *
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#getcurrentscope}
 */
export function getCurrentScope(): EffectScope | undefined {
  return activeEffectScope
}

/**
 * 在当前活动的 effect 作用域上注册释放回调。当关联的 effect 作用域停止时，
 * 将调用该回调。
 *
 * @param fn - 要附加到作用域清理的回调函数。
 * @see {@link https://vuejs.org/api/reactivity-advanced.html#onscopedispose}
 */
export function onScopeDispose(fn: () => void, failSilently = false): void {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn)
  } else if (__DEV__ && !failSilently) {
    warn(
      `onScopeDispose() is called when there is no active effect scope` +
        ` to be associated with.`,
    )
  }
}
