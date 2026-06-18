# GLB 压缩优化器

面向 `GLB` 的视觉压缩工具，支持：

- Windows 桌面版：`Electron + 本地服务`
- 网页版：`Express + Vite`，可部署到 Windows 或 Ubuntu
- 单文件压缩
- 批量压缩
- 输出命名规则
- 批量真实进度显示

当前保留的压缩策略是 **极致压缩**。它是有损压缩，目标是尽量减小体积，同时尽量保持肉眼观感。

## 项目结构

- `src/DesktopApp.tsx`
  桌面版前端入口，保留输出目录、打开输出位置等桌面能力。
- `src/WebApp.tsx`
  网页版前端入口，处理完成后直接提供下载。
- `src/App.tsx`
  运行时分支入口。
  有 `desktopBridge` 时走桌面版，没有时走网页版。
- `server/optimizer.ts`
  单文件压缩核心。
- `server/batch.ts`
  批量压缩核心。
- `server/app.ts`
  Web / Desktop 共用服务入口，包含桌面接口和网页接口。
- `electron/`
  桌面版主进程和预加载桥接。

## 网页版和桌面版的区别

### 桌面版

- 可以选择本地输出目录
- 处理完成后直接保存到你指定的位置
- 可以打开输出位置

### 网页版

- 不预选本地输出目录
- 单文件完成后提供 `.glb` 下载
- 批量完成后提供 `.zip` 下载
- 适合部署到服务器，通过浏览器访问

## 环境要求

建议：

- Node.js `20+`
- npm `10+`

最低建议：

- Node.js `18+`

## 从 GitHub 拉取并运行

把下面的仓库地址替换成你后面自己的 GitHub 地址。

```bash
git clone <your-github-repo-url>
cd glb无损压缩软件
npm install
```

## 开发命令

### 网页开发

```bash
npm run dev
```

说明：

- 前端开发页默认是 `Vite`
- 本地服务同时启动
- 适合开发网页版

### 桌面版开发

```bash
npm run start:desktop
```

## 构建

```bash
npm run build
```

构建后会生成：

- `dist/`
  前端静态资源
- `build/server/index.js`
  网页版服务入口
- `build/electron/main.js`
  桌面版主进程入口

## 网页版部署

网页版部署的标准流程是：

1. 拉取代码
2. 安装依赖
3. 构建
4. 启动 `build/server/index.js`
5. 用浏览器访问

### 通用启动方式

先构建：

```bash
npm run build
```

然后启动：

```bash
npm run serve:web
```

默认监听：

- `HOST=0.0.0.0`
- `PORT=4307`

如果不传环境变量，代码里默认端口就是 `4307`。

---

## 在 Windows 上部署网页版

### PowerShell 方式

```powershell
git clone <your-github-repo-url>
cd glb无损压缩软件
npm install
npm run build
$env:HOST='0.0.0.0'
$env:PORT='4307'
npm run serve:web
```

启动后浏览器访问：

```text
http://127.0.0.1:4307
```

如果你是在局域网里给别的机器访问，用服务器实际 IP 即可。

### 后台运行

可以用 Windows 服务管理器、任务计划程序，或者你自己的进程守护方式去托管：

```powershell
$env:HOST='0.0.0.0'
$env:PORT='4307'
Start-Process -FilePath npm.cmd -ArgumentList 'run serve:web' -WorkingDirectory . -WindowStyle Hidden
```

---

## 在 Ubuntu 上部署网页版

### 直接运行

```bash
git clone <your-github-repo-url>
cd glb无损压缩软件
npm install
npm run build
HOST=0.0.0.0 PORT=4307 npm run serve:web
```

### 后台运行

```bash
nohup HOST=0.0.0.0 PORT=4307 npm run serve:web > app.log 2>&1 &
```

### 建议使用 PM2

```bash
npm install -g pm2
pm2 start npm --name glb-web -- run serve:web
pm2 save
```

如果要带环境变量：

```bash
HOST=0.0.0.0 PORT=4307 pm2 start npm --name glb-web -- run serve:web
```

---

## Nginx 反向代理示例

适合 Ubuntu 服务器。

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4307;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果要挂 HTTPS，再在 Nginx 层配证书即可。

## 网页版接口行为

### 单文件

- 上传 1 个 `.glb`
- 服务端压缩
- 返回下载地址
- 浏览器下载压缩后的 `.glb`

### 批量

- 上传多个 `.glb`
- 或上传整个文件夹中的 `.glb`
- 服务端逐个处理
- 前端按真实完成数量显示进度
- 最后返回一个 `.zip` 下载地址

## 输出命名规则

支持 3 种：

### 原文件名

输出示例：

```text
robot.glb
```

### 原名+后缀

如果后缀填 `mini`，输出示例：

```text
robot_mini.glb
```

### 自定义名称

单文件示例：

```text
my-model.glb
```

批量示例：

```text
my-model-001.glb
my-model-002.glb
my-model-003.glb
```

## 存储目录说明

网页版运行时，会在项目根目录创建：

```text
storage/
```

主要用途：

- `storage/incoming`
  上传中的临时文件
- `storage/jobs`
  处理中间文件
- `storage/downloads`
  下载结果缓存

其中：

- 单文件下载结果会缓存到 `storage/downloads/<token>/`
- 批量 ZIP 也会缓存到这里
- 下载缓存会在服务启动时自动清理过期内容

## 已有脚本

- `npm run dev`
  开发模式，前端 + 服务一起跑
- `npm run build`
  构建前端和服务端
- `npm run serve:web`
  运行构建后的网页版服务
- `npm run start:web`
  先构建再启动网页版服务
- `npm run start:desktop`
  构建并启动桌面版
- `npm run dist:win`
  打 Windows 便携版

## 桌面版补充

如果你仍然需要 Windows 桌面版：

```bash
npm run start:desktop
```

或打包：

```bash
npm run dist:win
```

桌面版和网页版共用压缩核心，但交互不同：

- 桌面版保存到本地目录
- 网页版下载结果文件

## 注意事项

- 当前模式是视觉压缩，不是严格无损。
- 如果目标环境不支持 `Draco`、`WebP` 等扩展，压缩结果可能无法正常加载。
- 网页版处理是在服务器执行，敏感模型不要部署到不可信服务器。
- 批量压缩时，服务器磁盘空间需要足够容纳中间文件和最终 ZIP。
