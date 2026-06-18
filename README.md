# GLB 压缩优化器

支持 `GLB` 的单文件压缩、批量压缩、桌面版运行，以及网页部署版运行。

当前核心模式是 **极致压缩**：

- 目标是尽量减小体积
- 允许有损压缩
- 尽量保留肉眼观感

这个仓库现在同时包含两套运行形态：

- 桌面版：`Electron`
- 网页版：`Express + Vite`

如果你是要部署到服务器，重点看下面的 **网页版一键部署**。

## 仓库结构

- `src/DesktopApp.tsx`
  桌面版前端
- `src/WebApp.tsx`
  网页版前端
- `src/App.tsx`
  运行时分支入口
- `server/optimizer.ts`
  单文件压缩核心
- `server/batch.ts`
  批量压缩核心
- `server/app.ts`
  Web / Desktop 共用服务入口
- `scripts/deploy-web.mjs`
  网页版一键部署脚本

## 环境要求

- Node.js `20+`
- npm `10+`
- Git

最低建议：

- Node.js `18+`

## 从 GitHub 拉取

```bash
git clone https://github.com/chardlink/glb-optimizer.git
cd glb-optimizer
```

## 网页版一键部署

这个仓库已经内置了一条一键部署命令：

```bash
npm run deploy:web
```

这条命令会自动完成：

1. 安装依赖
2. 构建前端和服务端
3. 启动网页服务

默认访问地址：

```text
http://127.0.0.1:4307
```

关闭当前终端，网页服务也会一起停止。

---

## Windows 一键部署

### CMD

从 GitHub 拉取并一键启动：

```cmd
git clone https://github.com/chardlink/glb-optimizer.git && cd glb-optimizer && npm run deploy:web
```

### PowerShell

从 GitHub 拉取并一键启动：

```powershell
git clone https://github.com/chardlink/glb-optimizer.git; Set-Location glb-optimizer; npm run deploy:web
```

## Ubuntu 一键部署

```bash
git clone https://github.com/chardlink/glb-optimizer.git && cd glb-optimizer && npm run deploy:web
```

## 自定义监听地址和端口

如果你想改端口或监听地址，也可以保持“一条命令”。

### Windows PowerShell

```powershell
$env:HOST='0.0.0.0'; $env:PORT='8080'; npm run deploy:web
```

### Windows CMD

```cmd
set HOST=0.0.0.0 && set PORT=8080 && npm run deploy:web
```

### Ubuntu

```bash
HOST=0.0.0.0 PORT=8080 npm run deploy:web
```

## 网页版和桌面版的区别

### 桌面版

- 可以选择本地输出目录
- 处理完成后直接保存到指定目录
- 可以打开输出位置

### 网页版

- 不预选本地输出目录
- 单文件处理完成后提供 `.glb` 下载
- 批量处理完成后提供 `.zip` 下载
- 更适合部署到 Windows 或 Ubuntu 服务器

## 网页版上传和输出规则

### 单文件

- 上传 1 个 `.glb`
- 服务端压缩
- 返回下载链接
- 下载压缩后的 `.glb`

### 批量

- 上传多个 `.glb`
- 或上传整个文件夹中的 `.glb`
- 服务端逐个处理
- 前端按真实完成数量显示进度
- 最后返回一个 `.zip`

## 输出命名规则

支持 3 种模式：

### 原文件名

例如：

```text
robot.glb
```

### 原名+后缀

如果后缀填 `mini`，例如：

```text
robot_mini.glb
```

### 自定义名称

单文件：

```text
my-model.glb
```

批量：

```text
my-model-001.glb
my-model-002.glb
my-model-003.glb
```

## 运行时目录与清理

网页版运行时会在项目根目录创建：

```text
storage/
```

主要目录：

- `storage/incoming`
  上传中的临时文件
- `storage/jobs`
  压缩过程中的工作目录
- `storage/downloads`
  处理完成后的下载缓存

当前清理策略：

- `jobs` 会在处理结束后立即清掉
- `downloads` 会在服务启动时清理过期内容
- 下载缓存当前默认保留 `24 小时`

所以：

- 正常持续运行时，主要增长的是 `downloads`
- 中间工作目录一般不会长期堆积

## 常用命令

- `npm run dev`
  开发模式，前端和服务一起跑
- `npm run build`
  构建前端和服务端
- `npm run serve:web`
  运行构建后的网页服务
- `npm run deploy:web`
  一键安装依赖、构建并启动网页服务
- `npm run start:web`
  先构建再启动网页服务
- `npm run start:desktop`
  构建并启动桌面版
- `npm run dist:win`
  打 Windows 便携版

## 桌面版补充

如果你需要继续运行桌面版：

```bash
npm run start:desktop
```

如果你需要重新打 Windows 成品：

```bash
npm run dist:win
```

## 注意事项

- 当前模式是视觉压缩，不是严格无损。
- 如果目标环境不支持 `Draco`、`WebP` 等扩展，压缩结果可能无法正常加载。
- 网页版处理发生在当前服务器，敏感文件不要上传到不可信环境。
- 批量压缩时，服务器磁盘需要预留足够空间给中间文件和下载包。
