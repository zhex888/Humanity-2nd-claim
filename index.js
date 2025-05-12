import fs from "fs";
import fetch from "node-fetch";
import fetchCookie from "fetch-cookie";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CookieJar } from "tough-cookie";
import figlet from "figlet";
import chalk from "chalk";

const BASE_URL = "https://testnet.humanity.org";
const TOKEN_FILE = "tokens.txt";
const PROXY_FILE = "proxy.txt";
const LOG_FILE = "log.txt";

if (!fs.existsSync(TOKEN_FILE)) {
  console.error("❌ tokens.txt 不存在！");
  process.exit(1);
}

const TOKENS = fs.readFileSync(TOKEN_FILE, "utf-8").split("\n").map(t => t.trim()).filter(Boolean);
const PROXIES = fs.existsSync(PROXY_FILE)
  ? fs.readFileSync(PROXY_FILE, "utf-8").split("\n").map(p => p.trim()).filter(Boolean)
  : [];

function getRandomProxy() {
  if (PROXIES.length > 0) {
    const proxy = PROXIES[Math.floor(Math.random() * PROXIES.length)];
    return new HttpsProxyAgent(proxy);
  }
  return null;
}

function logError(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

function showBanner() {
  console.log(chalk.green(figlet.textSync("Humanity Auto Claim", { horizontalLayout: "default" })));
}

async function call(endpoint, token, agent, method = "POST", body = {}) {
  const url = BASE_URL + endpoint;
  const jar = new CookieJar();
  const fetchWithCookies = fetchCookie(fetch, jar);

  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    token: token,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  };

  try {
    const res = await fetchWithCookies(url, {
      method,
      headers,
      agent,
      body: method === "GET" ? undefined : JSON.stringify(body)
    });

    let responseData;
    try {
      responseData = await res.json();
    } catch (jsonErr) {
      throw new Error(`返回非 JSON 数据: ${jsonErr.message}`);
    }

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${responseData.message || "未知错误"}`);
    }

    return responseData;
  } catch (err) {
    throw new Error(`请求失败 (${endpoint}): ${err.message}`);
  }
}

async function processToken(token, index) {
  const agent = getRandomProxy();

  try {
    console.log(`\n🔹 开始处理 Token #${index + 1}`);

    const userInfo = await call("/api/user/userInfo", token, agent);
    console.log("✅ 用户:", userInfo.data.nickName);
    console.log("✅ 钱包:", userInfo.data.ethAddress);

    const balance = await call("/api/rewards/balance", token, agent, "GET");
    console.log("💰 当前奖励:", balance.balance.total_rewards);

    const rewardStatus = await call("/api/rewards/daily/check", token, agent);
    console.log("📊 状态:", rewardStatus.message);

    if (!rewardStatus.available) {
      console.log("⏳ 今日已签到，跳过...");
      return;
    }

    const claim = await call("/api/rewards/daily/claim", token, agent);
    
    // 检查 claim 返回的数据
    if (claim && claim.data && claim.data.amount) {
        console.log("🎉 签到成功，奖励:", claim.data.amount);
    } else if (claim.message && claim.message.includes('successfully claimed')) {
        console.log("🎉 你已经成功领取了今日的奖励。");
    } else {
        console.error("❌ 领取奖励失败，返回数据不符合预期:", claim);
        return;  // 跳过此轮请求，继续下一轮
    }

    const updatedBalance = await call("/api/rewards/balance", token, agent, "GET");

    // 检查更新后的余额数据
    if (updatedBalance && updatedBalance.balance) {
        console.log("💰 签到后奖励:", updatedBalance.balance.total_rewards);
    } else {
        console.error("❌ 更新奖励失败，返回数据不符合预期:", updatedBalance);
    }
} catch (err) {
    console.error("❌ 错误:", err.message);
    logError(`Token #${index + 1} 失败: ${err.message}`);
  }

  // 避免过快请求
  const delay = Math.floor(Math.random() * 5000) + 5000;
  console.log(`⏳ 暂停 ${delay / 1000} 秒...\n`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function batchRun() {
  showBanner();

  while (true) {
    console.log(`\n🚀 开始批量签到，共 ${TOKENS.length} 个账户...`);

    for (let i = 0; i < TOKENS.length; i++) {
      await processToken(TOKENS[i], i);
    }

    console.log(`✅ 本轮处理完毕，等待 6 小时后再次执行...\n`);
    await new Promise(resolve => setTimeout(resolve, 6 * 60 * 60 * 1000)); // 6 小时
  }
}

batchRun();
