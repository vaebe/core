# dep.ts 详细解析

这是 Vue 3 响应式系统中依赖管理的核心文件，实现了依赖收集和触发的机制。

---

## 一、全局版本号

```typescript
export let globalVersion = 0
```

**作用**: 每次响应式变化时递增，用于 Computed 的快速路径优化，避免在没有变化时重新计算。

---

## 二、Link 类 - 双向链表节点

Link 是 Dep 和 Subscriber (Effect/Computed) 之间的连接点，同时存在于两个双向链表中。

### 数据结构

```typescript
export class Link {
  version: number          // 版本号，用于依赖优化
  sub: Subscriber          // 订阅者 (Effect 或 Computed)
  dep: Dep                 // 依赖源

  // Effect 依赖链中的指针
  nextDep?: Link
  prevDep?: Link

  // Dep 订阅链中的指针
  nextSub?: Link
  prevSub?: Link

  // 用于优化查找
  prevActiveLink?: Link
}
```

### 双向链表结构图

```
                    ┌──────────────────────────────────────────────────┐
                    │                    Link 类                        │
                    ├──────────────────────────────────────────────────┤
                    │  sub: Subscriber (Effect/Computed)               │
                    │  dep: Dep                                        │
                    │  version: number                                 │
                    ├──────────────────────────────────────────────────┤
                    │           双向链表指针                            │
                    │  ┌──────────────────────────────────────────┐   │
                    │  │  Effect 的依赖链 (deps)                  │   │
                    │  │  nextDep → Link → Link → Link            │   │
                    │  │          ↕      ↕      ↕                  │   │
                    │  │  prevDep ← Link ← Link ← Link            │   │
                    │  └──────────────────────────────────────────┘   │
                    │  ┌──────────────────────────────────────────┐   │
                    │  │  Dep 的订阅链 (subs)                     │   │
                    │  │  nextSub → Link → Link → Link            │   │
                    │  │          ↕      ↕      ↕                  │   │
                    │  │  prevSub ← Link ← Link ← Link            │   │
                    │  └──────────────────────────────────────────┘   │
                    └──────────────────────────────────────────────────┘
```

### version 机制详解

```typescript
// version 的生命周期
// 1. 创建 Link 时
this.version = dep.version  // 初始化为 Dep 的当前版本

// 2. Effect 运行前
// 所有 Link.version 重置为 -1 (在 effect.ts 中实现)

// 3. Effect 运行期间 (track 时)
if (link.version === -1) {
  link.version = this.version  // 同步版本，表示该依赖被访问
}

// 4. Effect 运行后
// version 仍为 -1 的 Link 被清理 (未使用的依赖)
```

---

## 三、Dep 类 - 依赖管理器

Dep 是单个响应式属性的依赖管理器，维护所有订阅该属性的 Effects。

### 属性说明

```typescript
export class Dep {
  version = 0                    // 该 Dep 的版本号
  activeLink?: Link              // 当前 Effect 与此 Dep 的 Link
  subs?: Link                    // 订阅链尾部 (最新订阅者)
  subsHead?: Link                // 订阅链头部 (仅开发环境)
  map?: KeyToDepMap              // 所属的 KeyToDepMap (用于清理)
  key?: unknown                  // 对应的 key (用于清理)
  sc: number = 0                 // 订阅者计数器
  computed?: ComputedRefImpl     // 关联的 Computed (可选)
}
```

### track() - 依赖收集

```typescript
track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
  // 1. 前置检查
  if (!activeSub || !shouldTrack || activeSub === this.computed) {
    return  // 无活跃 effect 或不应追踪
  }

  let link = this.activeLink

  // 2. 情况 A: 创建新 Link
  if (link === undefined || link.sub !== activeSub) {
    link = this.activeLink = new Link(activeSub, this)

    // 2.1 添加到 Effect 的依赖链 (作为尾部)
    if (!activeSub.deps) {
      activeSub.deps = activeSub.depsTail = link
    } else {
      link.prevDep = activeSub.depsTail
      activeSub.depsTail!.nextDep = link
      activeSub.depsTail = link
    }

    // 2.2 添加到 Dep 的订阅链
    addSub(link)
  }
  // 3. 情况 B: 重用现有 Link (优化)
  else if (link.version === -1) {
    // 3.1 同步版本号
    link.version = this.version

    // 3.2 移动到 Effect 依赖链的尾部 (保持访问顺序)
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

      // 如果是头部，更新头部指针
      if (activeSub.deps === link) {
        activeSub.deps = next
      }
    }
  }

  // 4. 开发环境调试钩子
  if (__DEV__ && activeSub.onTrack) {
    activeSub.onTrack(extend({ effect: activeSub }, debugInfo))
  }

  return link
}
```

### track 流程图

```
┌─────────────────────────────────────────────────────────────────┐
│  Dep.track() 调用                                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  检查 activeSub       │
              │  shouldTrack         │
              │  activeSub !== computed│
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │  activeLink 存在？     │
              │  且 sub === activeSub?│
              └───────┬───────┬───────┘
                      │       │
               是 (重用) │       │ 否 (新建)
                      │       │
          ┌───────────▼───┐   │
          │ link.version  │   │
          │   === -1?     │   │
          └───────┬───────┘   │
                  │           │
         是       │           │ 否
      ┌───────────▼───┐       │
      │ 同步 version  │       │
      │ 移动到尾部    │       │
      └───────────────┘       │
                              │
                  ┌───────────▼───────────┐
                  │  创建新 Link          │
                  │  link = new Link(...) │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  添加到 Effect.deps   │
                  │  (作为尾部)           │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  addSub(link)         │
                  │  添加到 Dep.subs      │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  onTrack() 开发环境   │
                  └───────────┬───────────┘
                              │
                              ▼
                        return link
```

### trigger() - 触发更新

```typescript
trigger(debugInfo?: DebuggerEventExtraInfo): void {
  // 1. 增加版本号
  this.version++
  globalVersion++

  // 2. 通知所有订阅者
  this.notify(debugInfo)
}
```

### notify() - 通知订阅者

```typescript
notify(debugInfo?: DebuggerEventExtraInfo): void {
  startBatch()  // 开始批处理

  try {
    // 1. 开发环境: 按原始顺序调用 onTrigger 钩子
    if (__DEV__) {
      for (let head = this.subsHead; head; head = head.nextSub) {
        if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
          head.sub.onTrigger(extend({ effect: head.sub }, debugInfo))
        }
      }
    }

    // 2. 反向遍历订阅链 (后订阅的先执行)
    for (let link = this.subs; link; link = link.prevSub) {
      if (link.sub.notify()) {
        // 如果是 Computed，级联触发其依赖
        (link.sub as ComputedRefImpl).dep.notify()
      }
    }
  } finally {
    endBatch()  // 结束批处理，调度执行
  }
}
```

### 为什么反向遍历？

```
订阅顺序: Effect A → Effect B → Effect C
subs 链: A (head) → B → C (tail)

正向遍历问题:
A 执行可能触发 B 的更新 → B 再次执行 → C 执行
结果: B 被执行两次

反向遍历 (prevSub):
C → B → A
后订阅的先执行，避免重复触发
```

---

## 四、addSub() - 添加订阅者

```typescript
function addSub(link: Link) {
  // 1. 增加订阅者计数
  link.dep.sc++

  // 2. 检查 Effect 是否正在追踪
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed

    // 3. Computed 特殊处理: 获取第一个订阅者时
    if (computed && !link.dep.subs) {
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      // 懒订阅 Computed 的所有依赖
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l)
      }
    }

    // 4. 添加到 Dep 的订阅链 (作为尾部)
    const currentTail = link.dep.subs
    if (currentTail !== link) {
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link
    }

    // 5. 开发环境: 设置头部
    if (__DEV__ && link.dep.subsHead === undefined) {
      link.dep.subsHead = link
    }

    link.dep.subs = link
  }
}
```

### Computed 懒订阅机制

```
Computed 没有订阅者时:
- flags: DIRTY (不追踪依赖)
- 不触发其依赖的更新

Computed 获得第一个订阅者时:
- flags: TRACKING | DIRTY
- 懒订阅其所有依赖的 Dep
- 建立依赖传播链
```

---

## 五、全局函数

### targetMap - 全局依赖存储

```typescript
type KeyToDepMap = Map<any, Dep>
export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()
```

**结构**:
```
targetMap (WeakMap)
  ↓ target (object)
  ↓ KeyToDepMap (Map)
  ↓ key (string | symbol)
  ↓ Dep (依赖管理器)
```

### 特殊 Key

```typescript
export const ITERATE_KEY: unique symbol           // 对象迭代
export const MAP_KEY_ITERATE_KEY: unique symbol   // Map keys 迭代
export const ARRAY_ITERATE_KEY: unique symbol     // 数组迭代
```

### track() - 全局依赖收集

```typescript
export function track(target: object, type: TrackOpTypes, key: unknown): void {
  if (shouldTrack && activeSub) {
    // 1. 获取或创建 target 的依赖映射
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }

    // 2. 获取或创建 key 的 Dep
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = new Dep()))
      dep.map = depsMap
      dep.key = key
    }

    // 3. 执行依赖收集
    if (__DEV__) {
      dep.track({ target, type, key })
    } else {
      dep.track()
    }
  }
}
```

### trigger() - 全局触发更新

```typescript
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
    globalVersion++
    return  // 从未被追踪
  }

  const run = (dep: Dep | undefined) => {
    if (dep) {
      if (__DEV__) {
        dep.trigger({ target, type, key, newValue, oldValue, oldTarget })
      } else {
        dep.trigger()
      }
    }
  }

  startBatch()

  // 1. CLEAR 操作: 触发所有 effects
  if (type === TriggerOpTypes.CLEAR) {
    depsMap.forEach(run)
  }
  // 2. 数组 length 变化
  else if (isArray(target) && key === 'length') {
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
  }
  // 3. 其他操作
  else {
    // 3.1 触发特定 key 的 effects
    if (key !== void 0 || depsMap.has(void 0)) {
      run(depsMap.get(key))
    }

    // 3.2 数组索引变化: 触发 ARRAY_ITERATE_KEY
    const isArrayIndex = isArray(target) && isIntegerKey(key)
    if (isArrayIndex) {
      run(depsMap.get(ARRAY_ITERATE_KEY))
    }

    // 3.3 迭代器相关 effects
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          run(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            run(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isArrayIndex) {
          run(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
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

  endBatch()
}
```

### trigger 操作类型映射

| 操作类型 | 触发的 Dep | 说明 |
|---------|-----------|------|
| `SET` | `key` | 属性赋值 |
| `ADD` | `key`, `ITERATE_KEY`, `MAP_KEY_ITERATE_KEY`, `length` (数组) | 添加属性 |
| `DELETE` | `key`, `ITERATE_KEY`, `MAP_KEY_ITERATE_KEY` | 删除属性 |
| `CLEAR` | 所有 keys | 清空集合 |
| 数组 `length` | `length`, `ARRAY_ITERATE_KEY`, 索引 >= newLength | 修改长度 |

### getDepFromReactive() - 获取 Dep

```typescript
export function getDepFromReactive(
  object: any,
  key: string | number | symbol,
): Dep | undefined {
  const depMap = targetMap.get(object)
  return depMap && depMap.get(key)
}
```

**用途**: 在 ObjectRefImpl 中获取对象属性的 Dep，用于建立 ref 与 reactive 属性的连接。

---

## 六、完整依赖追踪流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        依赖收集 (track) 流程                              │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Effect 执行中访问响应式属性                                               │
│  effectFn() → reactive.prop                                              │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Proxy Handler 拦截 get 操作                                             │
│  baseHandlers.get()                                                     │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  调用 track(target, type, key)                                           │
│  targetMap.get(target) → KeyToDepMap                                    │
│  KeyToDepMap.get(key) → Dep                                             │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Dep.track()                                                            │
│  创建/重用 Link                                                          │
│  添加到 Effect.deps                                                      │
│  添加到 Dep.subs                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        依赖触发 (trigger) 流程                            │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  修改响应式属性                                                           │
│  reactive.prop = newValue                                               │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Proxy Handler 拦截 set 操作                                             │
│  baseHandlers.set()                                                     │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  调用 trigger(target, type, key, newValue, oldValue)                    │
│  targetMap.get(target) → KeyToDepMap                                    │
│  根据操作类型收集需要触发的 Dep                                         │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  对每个 Dep 调用 dep.trigger()                                           │
│  dep.version++                                                          │
│  globalVersion++                                                        │
│  dep.notify()                                                            │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Dep.notify()                                                           │
│  startBatch()                                                           │
│  反向遍历 dep.subs                                                       │
│  调用 each link.sub.notify()                                            │
│  endBatch() → 调度执行 effects                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 七、核心设计思想

### 1. 双向链表 vs 数组

| 特性 | 双向链表 | 数组 |
|------|---------|------|
| 插入/删除 | O(1) | O(n) |
| 内存开销 | 较高 (指针) | 较低 |
| 依赖顺序维护 | 容易 | 需要重排 |

### 2. WeakMap 的优势

- **自动 GC**: 当 target 没有引用时，整个依赖映射自动清理
- **无内存泄漏**: 避免持有对象引用导致无法回收

### 3. Link 重用机制

- 避免每次 track 都创建新 Link
- 通过 version 标识是否被访问
- 未访问的 Link (version === -1) 被清理

### 4. 批处理机制

```typescript
startBatch()
  // 多个 trigger 调用
endBatch()  // 统一调度执行
```

- 合并多次更新
- 避免重复执行
- 提升性能