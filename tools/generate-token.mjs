#!/usr/bin/env node
// MusicKit developer token 生成器（Apple Music 实验性模式用）
//
// 前置条件（一次性，需要 Apple Developer Program 付费账号）：
//   1. https://developer.apple.com/account/resources/identifiers/list/media
//      创建 Media ID（启用 MusicKit 服务）
//   2. https://developer.apple.com/account/resources/authkeys/list
//      创建 Media Services 私钥（勾选上面的 Media ID），下载 .p8 文件（只显示一次！）
//      记下 Key ID
//   3. Membership 页面记下 Team ID
//
// 用法：
//   node tools/generate-token.mjs \
//     --team DEF123GHIJ --key ABC123DEFG --p8 /path/to/AuthKey_ABC123DEFG.p8 \
//     [--origin http://localhost:8765] [--hours 2160]
//
// 依赖：npm install jose   （在本目录执行）
// origin 说明：加了 origin claim 的 token 只能在列出的源上使用；
//   桌面调试填 http://localhost:8765，APK 里是 https://localhost（当前应用源）。
//   不加 origin 则任意源可用（个人使用可省略）。

import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";
import { parseArgs } from "node:util";

const args = parseArgs({
  options: {
    team: { type: "string", short: "t" },
    key: { type: "string", short: "k" },
    p8: { type: "string", short: "p" },
    origin: { type: "string", short: "o" },
    hours: { type: "string", default: "2160" } // 默认 90 天（上限 182.5 天）
  }
});

const { team, key, p8, origin, hours } = args.values;

if (!team || !key || !p8) {
  console.error(
    "用法: node tools/generate-token.mjs --team <TeamID> --key <KeyID> --p8 <路径/AuthKey_XXX.p8> [--origin <url>] [--hours 2160]"
  );
  process.exit(1);
}

const privateKeyPem = readFileSync(p8, "utf8");
const privateKey = await importPKCS8(privateKeyPem, "ES256");

const now = Math.floor(Date.now() / 1000);
const lifetime = Math.min(parseInt(hours, 10) * 3600, 15777000); // Apple 上限 6 个月

const payload = { iss: team };
if (origin) payload.origin = [origin];

const token = await new SignJWT(payload)
  .setProtectedHeader({ alg: "ES256", kid: key, typ: "JWT" })
  .setIssuedAt(now)
  .setExpirationTime(now + lifetime)
  .sign(privateKey);

console.log("\n===== MusicKit Developer Token =====\n");
console.log(token);
console.log(`\n有效期至: ${new Date((now + lifetime) * 1000).toLocaleString("zh-CN")}`);
console.log("粘贴到 App 设置 → Apple Music → 开发者令牌 输入框即可。\n");
