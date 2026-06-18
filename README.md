# GLB 压缩优化器

一个面向 `GLB` 模型的压缩工具，提供两种运行形态：

- **桌面版**
  适合本机直接选择输出目录、批量处理、交付文件。
- **网页版**
  适合部署到 Windows / Ubuntu 服务器，通过浏览器上传、压缩并下载结果。

当前核心策略是 **极致压缩**：

- 允许有损压缩
- 目标是尽量减小体积
- 尽量保留肉眼观感

## 项目亮点

- 支持 **单文件** 和 **批量压缩**
- 支持 **网页部署版** 和 **桌面版**
- 支持 **输出命名规则**
- 批量压缩支持 **真实完成进度**
- 网页版支持 **一条命令部署**
- 网页版下载缓存支持 **自动清理**

## 快速开始

### 从 GitHub 拉取

```bash
git clone https://github.com/chardlink/glb-optimizer.git
cd glb-optimizer
```

### 一条命令启动网页版

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

关闭当前终端，网页服务会一起停止。

## 一键部署

### Windows CMD

```cmd
git clone https://github.com/chardlink/glb-optimizer.git && cd glb-optimizer && npm run deploy:web
```

### Windows PowerShell

```powershell
git clone https://github.com/chardlink/glb-optimizer.git; Set-Location glb-optimizer; npm run deploy:web
```

### Ubuntu

```bash
git clone https://github.com/chardlink/glb-optimizer.git && cd glb-optimizer && npm run deploy:web
```

## 自定义端口和监听地址

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

## 两种版本的区别

### 桌面版

- 可以选择本地输出目录
- 压缩完成后直接保存到指定目录
- 可以打开输出位置

### 网页版

- 不预选本地输出目录
- 单文件完成后提供 `.glb` 下载
- 批量完成后提供 `.zip` 下载
- 更适合部署到服务器或局域网环境

## 网页版上传与输出逻辑

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

```text
robot.glb
```

### 原名 + 后缀

后缀填写 `mini` 时，例如：

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

## 运行目录与自动清理

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

- `jobs` 在处理结束后立即删除
- `downloads` 在服务启动时会先清理一次过期文件
- 服务运行期间会 **每 24 小时自动再清理一次**
- 下载缓存默认保留 **24 小时**

因此：

- 正常运行时，`jobs` 不会长期堆积
- 真正会持续增长的主要是 `downloads`
- 长时间在线部署时，缓存也会被周期性自动清理

## 本地开发

### 网页开发

```bash
npm run dev
```

### 桌面版开发

```bash
npm run start:desktop
```

## 常用命令

- `npm run dev`
  前端和服务一起跑的开发模式
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

## 项目结构

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

建议：

- Node.js `20+`
- npm `10+`

最低建议：

- Node.js `18+`

## 注意事项

- 当前模式是**视觉压缩**，不是严格无损。
- 如果目标环境不支持 `Draco`、`WebP` 等扩展，压缩结果可能无法正常加载。
- 网页版处理发生在当前服务器，不建议上传到不可信环境处理敏感文件。
- 批量压缩时，服务器磁盘需要预留足够空间存放中间文件和下载包。
