const https = require('https');
const querystring = require('querystring');
const url = require('url');

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
const SERVER_ID = process.env.SERVER_ID;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0';

if (!EMAIL || !PASSWORD) {
  console.error('错误: 环境变量 EMAIL 和 PASSWORD 必须设置');
  process.exit(1);
}

function httpGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: data
      }));
    }).on('error', reject);
  });
}

function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: data
      }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function extractCookies(setCookieHeader) {
  const cookies = [];
  if (!setCookieHeader) return cookies;
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const c of raw) cookies.push(c.split(';')[0]);
  return cookies;
}

async function login(email, password) {
  const getRes = await httpGet('https://www.yunmc.vip/login');
  const cookies1 = extractCookies(getRes.headers['set-cookie']);
  const phpsessid = cookies1.find(c => c.startsWith('PHPSESSID='));
  const tokenMatch = getRes.body.match(/name="token" value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : null;
  if (!phpsessid || !token) throw new Error('获取登录凭证失败');

  const postData = querystring.stringify({ email, password, token });
  const loginOptions = {
    ...url.parse('https://www.yunmc.vip/login?action=email'),
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': phpsessid,
      'User-Agent': USER_AGENT,
    }
  };
  const loginRes = await httpRequest(loginOptions, postData);

  const cookies2 = extractCookies(loginRes.headers['set-cookie']);
  const allCookies = [phpsessid, ...cookies2.filter(c => c !== phpsessid)];
  const cookieStr = allCookies.join('; ');
  return { cookieStr, loginRes };
}

async function sign(cookieStr) {
  const signUrl = 'https://www.yunmc.vip/addons?_plugin=points_mall&_controller=index&_action=sign';
  const options = {
    ...url.parse(signUrl),
    method: 'POST',
    headers: {
      'Cookie': cookieStr,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': USER_AGENT,
      'Content-Length': '0',
    }
  };
  const res = await httpRequest(options, '');
  try {
    return { statusCode: res.statusCode, result: JSON.parse(res.body) };
  } catch {
    return { statusCode: res.statusCode, raw: res.body };
  }
}

async function getPoints(cookieStr) {
  const pointsUrl = 'https://www.yunmc.vip/addons?_plugin=points_mall&_controller=index&_action=index';
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cookie': cookieStr,
    'Referer': 'https://www.yunmc.vip/clientarea',
    'User-Agent': USER_AGENT,
  };
  const res = await httpGet(pointsUrl, headers);
  
  const pointsMatch = res.body.match(/当前积分:\s*(\d+)\s*分/);
  if (!pointsMatch) {
    throw new Error('获取积分失败，未找到积分信息');
  }
  return parseInt(pointsMatch[1], 10);
}

async function renewServer(cookieStr, serverId) {
  const renewUrl = `https://api.yunmc.vip/xf.php?id=${serverId}`;
  const headers = {
    'Cookie': cookieStr,
    'Referer': 'https://www.yunmc.vip/',
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
  };
  const res = await httpGet(renewUrl, headers);
  return { statusCode: res.statusCode, message: res.body.trim() };
}

(async () => {
  try {
    console.log('===== 海绵科创 自动签到续费脚本 =====');
    console.log('时间:', new Date().toLocaleString());

    console.log('\n[登录] 正在获取凭证...');
    const { cookieStr, loginRes } = await login(EMAIL, PASSWORD);
    if (loginRes.statusCode !== 302 || loginRes.headers.location !== '/clientarea') {
      throw new Error('登录失败，请检查账号密码');
    }
    console.log('[登录] 成功，已获取 Cookie');

    console.log('\n[签到] 正在签到...');
    const signRes = await sign(cookieStr);
    console.log('[签到] 响应:', JSON.stringify(signRes.result || signRes.raw));
    if (signRes.result && signRes.result.code === 200) {
      console.log(`[签到] ✅ ${signRes.result.msg}`);
    } else {
      console.log('[签到] ⚠️ 签到可能失败，继续检查积分...');
    }

    console.log('\n[积分检查] 正在获取当前积分...');
    const currentPoints = await getPoints(cookieStr);
    console.log(`[积分检查] 当前积分: ${currentPoints} 分`);

    const RENEW_POINTS_THRESHOLD = 1200;
    if (currentPoints < RENEW_POINTS_THRESHOLD) {
      console.log(`[积分检查] ⚠️ 积分不足 ${RENEW_POINTS_THRESHOLD} 分，暂不续费`);
      console.log('\n===== 脚本执行完毕 =====');
      process.exit(0);
    }

    console.log(`[积分检查] ✅ 积分足够 (${currentPoints} >= ${RENEW_POINTS_THRESHOLD})，开始续费...`);

    console.log(`\n[续费] 正在为服务器续费...`);
    const renewRes = await renewServer(cookieStr, SERVER_ID);
    console.log('[续费] 响应:', renewRes.message);

    if (renewRes.message.includes('积分足够') || renewRes.message.includes('成功')) {
      console.log('[续费] ✅ 续费成功，服务器到期时间已延长！');
    } else if (renewRes.message.includes('积分不足')) {
      console.log('[续费] ❌ 积分不足，下次继续积累');
    } else {
      console.log('[续费] ⚠️ 未知返回，请手动检查');
    }
  } catch (err) {
    console.error('运行出错:', err.message);
    process.exit(1);
  }
})();