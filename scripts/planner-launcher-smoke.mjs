import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aiPlanFixture } from './planner-fixture.mjs';

/** 固定在屏幕上的两个元素：
 * 1.“问 AI / 修改”悬浮按钮始终可见可点（桌面与手机）。回归：祖先带 transform 动画会让它跑到页面最底部。
 * 2. AI 进度条只在 AI 工作时出现并固定在屏幕上，显示简短状态；结束后消失，不常驻。
 * 3. 小红书解析和 AI 分析可收起，切到其他页面或行程也能完成，并回到原行程查看结果。
 * 另检查回答中的“相关链接”单独成段、在新窗口打开。
 */
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await (await browser.newContext({ serviceWorkers: 'block', viewport })).newPage();
    let releaseParse;
    const parseHeld = new Promise((resolve) => { releaseParse = resolve; });
    let releaseChat;
    const chatHeld = new Promise((resolve) => { releaseChat = resolve; });
    const reference = {
      id: 'background-xhs', sourceType: 'text', title: '丽江参考攻略', destinations: ['丽江'],
      suggestedDays: null, styleTags: [], routeOutline: [], tips: [],
      places: [{ id: 'old-town', name: '丽江古城', canonicalName: '丽江古城', city: '丽江', kind: 'sight', dayHint: 1, note: '', selected: true }],
    };
    const originalPlan = aiPlanFixture();
    const otherPlan = { ...aiPlanFixture(), id: 'other-plan', content: { ...originalPlan.content, title: '另一份行程' } };
    await page.route('**/api/planner/**', async (route) => {
      if (route.request().url().endsWith('/tickets')) {
        return route.fulfill({ json: { items: [], networkAvailable: false, generatedAt: originalPlan.updatedAt } });
      }
      if (route.request().url().endsWith('/xhs-parse')) {
        await parseHeld;
        return route.fulfill({ json: { reference } });
      }
      if (!route.request().url().endsWith('/chat')) return route.fulfill({ json: { photo: null, configured: true } });
      const { plan, baseVersion, xhsReferences } = route.request().postDataJSON();
      assert.equal(plan.id, originalPlan.id);
      assert.equal(xhsReferences[0].id, reference.id);
      await chatHeld;
      return route.fulfill({ contentType: 'application/x-ndjson', body: [
        { type: 'progress', stage: '正在优先检索小红书攻略与游玩评价，同时核对官方资料' },
        { type: 'result', result: { action: 'answer', baseVersion,
          answer: '玉龙雪山需提前 7 天实名预约。\n相关链接：玉龙雪山预约与票价 https://www.sina.cn/news/article/comos_niuvanp5849903.html ；云南天气 https://health.weather.com.cn/news/2026/11/4855689.shtml。' } },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n' });
    });
    await page.goto('http://127.0.0.1:5173/');
    await page.evaluate(async (plans) => {
      const { saveAiPlan } = await import('/src/db.ts');
      for (const plan of plans) await saveAiPlan(plan, null);
    }, [originalPlan, otherPlan]);
    await page.reload();
    await page.getByRole('button', { name: '行程规划' }).first().click();
    const planSelection = page.getByLabel('当前行程', { exact: true });
    await planSelection.selectOption(originalPlan.id);
    const launcher = page.locator('.planner-ai-launcher');
    await launcher.waitFor();
    const assistant = page.getByRole('region', { name: 'AI 行程对话' });
    const toggle = assistant.getByRole('button', { name: 'AI 助手', exact: true });
    const composer = page.locator('#planner-chat-input');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await composer.isVisible(), false, 'chat is collapsed when first opening the itinerary');
    const status = page.locator('.planner-status');
    assert.equal(await status.count(), 0, 'no fixed status bar while AI is idle');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const y of [0, height / 2, height]) {
      await page.evaluate((value) => window.scrollTo(0, value), y);
      await page.waitForTimeout(150);
      const box = await launcher.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `launcher stays on screen at scroll ${Math.round(y)} (${viewport.width}px): top ${Math.round(box.y)}`);
    }
    await launcher.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await composer.evaluate((input) => document.activeElement === input), true);
    await composer.fill('保留这条问答草稿');
    await toggle.press('Enter');
    assert.equal(await composer.isVisible(), false, 'heading collapses the assistant');
    await launcher.click();
    assert.equal(await composer.inputValue(), '保留这条问答草稿');
    assert.equal(await composer.evaluate((input) => document.activeElement === input), true);
    await composer.fill('');
    await toggle.click();

    // 开始解析后，通过顶部按钮或 Esc 都能收起；打开新页面期间解析可正常完成。
    await page.getByRole('button', { name: '✦ 小红书加点 / 改计划', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '小红书加点 · 参考改计划' });
    await dialog.getByRole('textbox').fill('丽江古城适合散步。');
    await dialog.getByRole('button', { name: '✦ AI 解析小红书内容' }).click();
    await dialog.getByRole('button', { name: '收起', exact: true }).click();
    const parsingShortcut = page.getByRole('button', { name: '小红书解析中 · 查看', exact: true });
    await parsingShortcut.click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.getByRole('button', { name: '个人中心' }).click();
    await parsingShortcut.waitFor();
    releaseParse();
    await page.getByRole('button', { name: '返回小红书', exact: true }).click();
    await dialog.getByRole('heading', { name: reference.title }).waitFor();
    assert.equal(await dialog.getByRole('checkbox').isChecked(), true, 'parsed selections survive hiding the dialog and leaving the planner');
    await dialog.getByRole('button', { name: '参考这篇改计划 / 排雷', exact: true }).click();
    await dialog.getByRole('textbox', { name: '或输入你自己的参考改造要求' }).fill('玉龙雪山怎么预约？');
    await dialog.getByRole('button', { name: '发给 AI 分析并给方案', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'sending from another entry opens the original chat');

    // AI 思考中：进度条出现、固定在屏幕内、只显示正在做什么；滚动后仍在屏幕上。
    await status.waitFor();
    assert.equal(await status.evaluate((element) => getComputedStyle(element).position), 'fixed');
    assert.match(await status.innerText(), /…/);
    assert.ok((await status.innerText()).length < 20, 'progress shows a short action, not a long sentence');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const statusBox = await status.boundingBox();
    assert.ok(statusBox.y >= 0 && statusBox.y + statusBox.height <= viewport.height, 'status stays on screen while AI works');

    // 工作中可以查看预算和另一份行程；“返回任务”回到原行程，切到个人中心也不取消。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('tab', { name: '预算与账本' }).click();
    await status.getByRole('button', { name: '返回任务' }).click();
    await planSelection.selectOption(otherPlan.id);
    await status.getByRole('button', { name: '返回任务' }).click();
    assert.equal(await planSelection.inputValue(), originalPlan.id);
    await nav.getByRole('button', { name: '个人中心' }).click();
    await status.waitFor();
    releaseChat();
    const notification = page.locator('.toast');
    await notification.waitFor();
    assert.match(await notification.innerText(), /AI 任务已完成/);
    await nav.getByRole('button', { name: '行程规划' }).click();

    // 回答写回发起任务时的行程；进度条消失，链接单独成段，在新窗口打开。
    const links = page.locator('.planner-links a');
    await links.first().waitFor();
    assert.equal(await status.count(), 0, 'status disappears once AI finishes');
    assert.deepEqual(await links.allInnerTexts(), ['玉龙雪山预约与票价', '云南天气']);
    assert.equal(await links.first().getAttribute('target'), '_blank');
    assert.equal(await links.nth(1).getAttribute('href'), 'https://health.weather.com.cn/news/2026/11/4855689.shtml');
    assert.ok(!(await page.locator('.planner-message.assistant p').last().innerText()).includes('http'), 'answer body has no bare URLs');
    await toggle.click();
    assert.equal(await links.first().isVisible(), false);
    await launcher.click();
    assert.deepEqual(await links.allInnerTexts(), ['玉龙雪山预约与票价', '云南天气'], 'saved replies survive collapsing');
    await page.close();
  }
  console.log('Planner fixed UI: collapsible chat, launcher focus, background work and saved replies: OK');
} finally {
  await browser.close();
}
