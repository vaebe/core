# Vue.js Core - Agent 上下文文档

## 项目概述

这是 Vue.js 3.x 的核心代码仓库，采用 Monorepo 架构。Vue.js 是一个渐进式 JavaScript 框架，用于构建用户界面。

**主要技术栈：**

- 开发语言：TypeScript
- 构建工具：Rollup（生产构建）、Vite + ESBuild（开发构建）
- 测试框架：Vitest
- 代码格式化：Prettier
- 代码检查：ESLint + TypeScript
- 包管理器：pnpm（必须使用，版本 >= 10.29.2）
- Node.js 要求：>= 20.0.0

**项目架构：**
代码库采用 Monorepo 结构，包含多个相关联的包，位于 `packages/` 目录下。每个包都可以独立使用，但它们共同构成了完整的 Vue.js 框架。

## 核心包结构

### 公共包（发布到 npm）

- **reactivity** - 响应式系统，可作为框架无关的独立包使用
- **runtime-core** - 平台无关的运行时核心，包含虚拟 DOM 渲染器、组件实现和 JavaScript API
- **runtime-dom** - 面向浏览器的运行时，包含原生 DOM API、属性、属性值、事件处理器等处理
- **runtime-test** - 用于测试的轻量级运行时，渲染纯 JavaScript 对象树
- **server-renderer** - 服务端渲染包
- **compiler-core** - 平台无关的编译器核心
- **compiler-dom** - 针对浏览器的编译器
- **compiler-sfc** - 编译 Vue 单文件组件的低级工具
- **compiler-ssr** - 生成针对服务端渲染优化的渲染函数的编译器
- **shared** - 跨多个包共享的内部工具（特别是运行时和编译器包都使用的环境无关工具）
- **vue** - 公共的"完整构建"，包含运行时和编译器
- **vue-compat** - Vue 2 兼容层

### 私有包（不发布）

- **dts-test** - 针对生成的 d.ts 文件的类型测试
- **sfc-playground** - SFC Playground（<https://play.vuejs.org）>
- **template-explorer** - 编译器输出调试工具（<https://template-explorer.vuejs.org/）>

## 构建和运行命令

### 环境准备

```bash
# 安装依赖（必须使用 pnpm）
pnpm i
```

### 开发模式

```bash
# 开发模式构建（默认构建 vue 包，格式为 global）
nr dev

# 指定包名和格式
nr dev runtime-core -f global

# 带源码映射（会使重建变慢）
nr dev -s

# 内联所有依赖（用于调试 esm-bundler 构建）
nr dev -i
```

### 构建命令

```bash
# 构建所有公共包
nr build

# 构建特定包（模糊匹配）
nr build runtime-core
nr build runtime --all

# 指定构建格式
nr build runtime-core -f global
nr build runtime-core -f esm-browser,cjs

# 构建类型声明
nr build-dts

# 构建带源码映射
nr build --sourcemap
```

### 构建格式

- **global** - IIFE 格式，适合直接在浏览器中使用
- **esm-bundler** - ESM 格式，供打包工具使用
- **esm-browser** - ESM 格式，适合直接在浏览器中使用
- **cjs** - CommonJS 格式
- **global-runtime** - 仅运行时的 IIFE 格式（仅 vue 包）
- **esm-bundler-runtime** - 仅运行时的 ESM 格式（仅 vue 包）
- **esm-browser-runtime** - 仅运行时的浏览器 ESM 格式（仅 vue 包）

### 测试命令

```bash
# 运行所有测试（监视模式）
nr test

# 运行一次并退出
nr test run

# 运行特定包的测试
nr test runtime-core

# 运行匹配模式的测试
nr test <fileNamePattern>

# 运行特定测试
nr test <fileNamePattern> -t 'test name'

# 运行单元测试
nr test-unit

# 运行端到端测试
nr test-e2e

# 生成测试覆盖率报告
nr test-coverage

# 运行类型测试
nr test-dts
```

### 其他实用命令

```bash
# 类型检查整个项目
nr check

# 代码检查
nr lint

# 代码格式化
nr format

# 检查格式
nr format-check

# 清理构建产物
nr clean

# 启动 SFC Playground（本地开发）
nr dev-sfc

# 构建 ESM 运行时（用于调试真实构建场景）
nr dev-esm

# 启动模板浏览器
nr dev-compiler
```

## 开发规范

### 提交消息规范

提交消息必须遵循以下格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型（type）：**

- `feat` - 新功能
- `fix` - 修复
- `docs` - 文档
- `dx` - 开发体验
- `style` - 代码格式
- `refactor` - 重构
- `perf` - 性能优化
- `test` - 测试
- `workflow` - 工作流
- `build` - 构建
- `ci` - CI 配置
- `chore` - 杂项
- `types` - 类型
- `wip` - 进行中

**作用域（scope）：**
可以是任何指定提交更改位置的内容，例如 `core`、`compiler`、`ssr`、`v-model`、`transition` 等。

**主题（subject）：**

- 使用祈使句、现在时："change" 而不是 "changed" 或 "changes"
- 不要首字母大写
- 末尾不要加句号

**示例：**

```
feat(compiler): add 'comments' option
fix(v-model): handle events on blur
perf(core): improve vdom diffing by removing 'foo' option
```

### 代码规范

**重要约束：**

1. **输出目标：ES2016** - 以下语法被禁止，因为会生成冗长的辅助代码：
   - 不使用 `const enum`（使用普通枚举，项目会自动内联）
   - 不使用对象展开运算符（`...`），使用 `@vue/shared` 的 `extend` 助手
   - 不使用可选链（`?.`）
   - 不使用 async/await

2. **导入规则：**
   - 跨包导入时，不要使用相对路径，应该在源包中导出并在包级别导入
   - 编译器包不应从运行时导入，反之亦然。如果需要共享，应提取到 `@vue/shared`
   - 类型导入必须使用 `import type`
   - 始终使用 `@ts-expect-error` 注释来标记预期的类型错误

3. **环境约束：**
   - 大部分代码应与环境无关（不使用 `window`、`document`、`module`、`require`）
   - 包根据其目标环境有不同的约束

### Git Hooks

项目使用 `simple-git-hooks` 在每次提交时强制执行：

- 类型检查整个项目
- 使用 Prettier 自动格式化更改的文件
- 验证提交消息格式

### 包依赖关系

```
compiler-sfc → compiler-core + compiler-dom
compiler-dom → compiler-core
vue → compiler-dom + runtime-dom
runtime-dom → runtime-core
runtime-core → reactivity
```

## 贡献指南

### 代码贡献原则

- **Bug 修复**：必须有明确的复现（来自相关 issue 或包含在 PR 中）
- **新功能**：必须针对清晰且广泛适用的用例。如果功能有非平凡的 API 表面添加，应先在 RFC repo 讨论
- **重构**：仅接受能提高性能或有充分理由证明客观提高代码质量的重构。不鼓励纯风格性的重构
- **提交前**：确保测试通过，遵循提交消息规范

### PR 分支选择

- `main` 分支：非 API 表面添加的 PR（bug 修复、chore、文档等）
- `minor` 分支：添加新 API 表面的功能 PR

### 测试规范

- 单元测试与代码位于同一目录的 `__tests__` 文件夹中
- 使用最小 API 编写测试用例
- 测试平台无关行为或低级虚拟 DOM 操作时，使用 `@vue/runtime-test`
- 仅在测试平台特定行为时才使用平台特定的运行时

## 工作空间配置

项目使用 pnpm workspace，配置在 `pnpm-workspace.yaml` 中：

- `packages/*` - 公共包
- `packages-private/*` - 私有包

包之间可以直接通过包名导入（如 `import { h } from '@vue/runtime-core'`），通过以下配置实现：

- TypeScript: `tsconfig.json` 中的 `compilerOptions.paths`
- Vitest 和 Rollup: `scripts/aliases.js` 中的别名
- Node.js: PNPM Workspaces 链接

## 重要文件位置

- **TypeScript 配置**: `tsconfig.json`
- **ESLint 配置**: `eslint.config.js`
- **Vitest 配置**: `vitest.config.ts`
- **Rollup 配置**: `rollup.config.js`
- **别名配置**: `scripts/aliases.js`
- **贡献指南**: `.github/contributing.md`
- **提交规范**: `.github/commit-convention.md`
