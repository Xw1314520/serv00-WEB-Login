import puppeteer from 'puppeteer';
import fetch from 'node-fetch';

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const LOGIN_INFO = JSON.parse(process.env.LOGIN_INFO);

const TG_API_URL = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;

const getIPAddress = async () => {
    const response = await fetch('https://api.ipify.org/?format=json');
    const data = await response.json();
    return data.ip;
};

const getBeijingTime = () => {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date()).replace(/\//g, '-');
};

const sendTelegramNotification = async (message) => {
    await fetch(TG_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        })
    });
};

const validateLoginUrl = (url) => {
    const regex = /^https:\/\/panel.*\.(com|pl)$/;
    return regex.test(url);
};

const loginAndCheck = async (user, ipAddress) => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process'
        ]
    });
    const page = await browser.newPage();
    const LOGIN_URL = `${user.login_url}/login`;
    const CHECK_URL = user.login_url;

    let attempts = 0;
    let loggedIn = false;
    const beijingTime = getBeijingTime();

    while (attempts < 3 && !loggedIn) {
        try {
            await page.goto(LOGIN_URL, { 
                waitUntil: 'networkidle2',
                timeout: 60000  // 增加超时时间到60秒
            });
            
            // 输入凭据
            await page.type('#id_username', user.username);
            await page.type('#id_password', user.password);
            
            // 提交表单
            await Promise.all([
                page.click('#submit'),
                page.waitForNavigation({ 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                })
            ]);

            // 验证登录结果
            const title = await page.title();
            const regexStrona = /Strona/i;
            const regexHome = /home/i;

            if (regexStrona.test(title) || regexHome.test(title)) {
                await page.waitForSelector('.table.nostripes.table-condensed', {
                    timeout: 30000
                });

                // 获取到期日期
                let expirationDate;
                try {
                    expirationDate = await page.evaluate(() => {
                        const expirationRow = document.querySelectorAll('.table.nostripes.table-condensed tr')[2];
                        return expirationRow?.querySelectorAll('td')[1]?.innerText || '未找到日期';
                    });

                    // 日期格式处理（保持不变）
                    // ... [原有日期解析代码]
                } catch (error) {
                    console.error(`日期解析错误: ${error.message}`);
                    expirationDate = '日期解析失败';
                }

                await browser.close();
                return `✅ 登录成功\n用户: ${user.username}\n到期: ${expirationDate}\n面板: ${user.login_url}\nIP: ${ipAddress}\n时间: ${beijingTime}`;
            }
            attempts++;
        } catch (error) {
            console.error(`第 ${attempts+1} 次尝试失败: ${error.message}`);
            attempts++;
        } finally {
            if (attempts < 3) await new Promise(res => setTimeout(res, 10000)); // 10秒重试间隔
        }
    }

    await browser.close();
    return `❌ 登录失败\n用户: ${user.username}\n面板: ${user.login_url}\nIP: ${ipAddress}\n时间: ${beijingTime}`;
};

const main = async () => {
    try {
        const ipAddress = await getIPAddress();
        let combinedMessage = '';
        
        for (const user of LOGIN_INFO) {
            if (!validateLoginUrl(user.login_url)) {
                combinedMessage += `\n\n❌ URL格式错误: ${user.login_url}`;
                continue;
            }
            
            const result = await loginAndCheck(user, ipAddress);
            combinedMessage += combinedMessage ? '\n\n' + result : result;
        }

        if (TG_BOT_TOKEN && TG_CHAT_ID) {
            await sendTelegramNotification(combinedMessage);
        } else {
            console.log(combinedMessage);
        }
    } catch (error) {
        console.error('主函数错误:', error);
    } finally {
        process.exit(0);
    }
};

main().catch(console.error);
