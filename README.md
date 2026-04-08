# Misuzu

![二次元小女孩图片](.github/readme/himari.jpg)

什么？你问我 Misuzu 是什么？🤓

Misuzu 是杀死了一切 CTF 比赛的 CTF Agent 😁

让我们看看截图 🫡

<table>
  <tr>
    <td align="center">
      <img src="./.github/readme/chat.png" alt="Home light mode" /><br />
      每一个顶级软件都会有的——聊天框!!!!! 😮
    </td>
    <td align="center">
      <img src="./.github/readme/dashboard.png" alt="yuanshenniubi" /><br />
      看起来特别牛逼的仪表盘 👽
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./.github/readme/env.png" alt="ZiDongShiPeiPingTai" /><br />
      会自动适配平台 🙌
    </td>
    <td align="center">
      <img src="./.github/readme/wp.png" alt="会写 WP 🤩 admin" /><br />
      会写 WP 🤩
    </td>
  </tr>
</table>

想象在古代，你作为一个普通 CTFer, 能够拥有这么一个 Misuzu-Agent 将会是多么的**爽** 🤯

- 开源，只需要指挥别的 claude, kimi, codex, gemini 啥的就可以轻松在这坨 slop 上雕出独属于你的花，**爽！**
- 全自动适配 CTF 平台，莫名其妙地居然能绕过 Cloudflare Turnstile, **爽！**
- shadcn 批发出来的美丽 Web UI， 只需要 frp 一下就可以躺着看 Misuzu 上分，**爽！**
- 一套经过顶级程序员兼数学家考德克斯五点三世设计的 rank rebalancer，让烂题永远卡不住你上分的脚步，**爽！**

老哥们，集美们，看到这个项目，我已经忍不住想要 **star** 一下，然后掏出自己的 token 在随便哪场 CTF 比赛叱咤风云了，所以赶紧行动吧。

---

## README.md

> 涅奥：你怎么还在这...

Misuzu 是一个实现了平台适配、自动化编排的专为 CTF 比赛特化的多 Agent 并发系统。

### 使用

确保你的环境拥有 docker, [viteplus](https://viteplus.dev/), chrome.

```bash
# 安装 playwright-cli
npm install -g @playwright/cli@latest
# 构建 docker 沙盒环境
cd packages/misuzu-core/src/tools/misuzu/sandbox
docker build -f Dockerfile.sandbox -t ctf-sandbox .
# 安装依赖
vp i
# 启动开发服务器
vp run misuzu-web#dev:full
```

然后你就可以打开 <http://localhost:5173/> 按 UI 指示配置模型、目录等，开始梭哈一场 CTF 了。

### 注意

- 本项目还处于开发迭代阶段，暂时不接受除 bug 修复以外的 PR, 新功能提议可以先发 issue.
- 本项目目前有大量 AI 生成且未经审计的代码，使用本项目意味着你明白项目存在的潜在的风险。
