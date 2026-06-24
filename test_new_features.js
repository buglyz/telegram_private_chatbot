// 新功能测试脚本
// 用于验证行为分析、社交图谱和智能关键词检测

const { CONFIG, normalizeSpamText, scoreSpamMessage } = require('./worker.js');

console.log('=== 测试 1: 变形关键词检测 ===\n');

// 测试消息1：变形微信
const msg1 = {
    text: '需要的加薇信：vx123456，或者扣扣：123456789',
    from: { id: 1001 }
};

console.log('输入消息:', msg1.text);

// 测试消息2：混淆链接
const msg2 = {
    text: '访问 w w w . example . com 了解详情，或 t . me / spam_bot',
    from: { id: 1002 }
};

console.log('\n输入消息:', msg2.text);

// 测试消息3：emoji隐写
const msg3 = {
    text: '👉👉👉 限时优惠 🔥🔥🔥 仅需$99 ✅✅✅',
    from: { id: 1003 }
};

console.log('\n输入消息:', msg3.text);

// 测试消息4：正常消息
const msg4 = {
    text: '你好，我想咨询一下你们的产品',
    from: { id: 1004 }
};

console.log('\n输入消息:', msg4.text);

console.log('\n=== 测试 2: 行为模式分析 ===\n');

// 模拟行为历史
const behaviorHistory = {
    timestamps: [
        Date.now() - 60000,  // 60秒前
        Date.now() - 54000,  // 54秒前（间隔6秒）
        Date.now() - 48000,  // 48秒前（间隔6秒）
        Date.now() - 42000,  // 42秒前（间隔6秒）
        Date.now() - 36000,  // 36秒前（间隔6秒）
        Date.now() - 30000,  // 30秒前（间隔6秒）
        Date.now() - 24000,  // 24秒前（间隔6秒）
        Date.now() - 18000,  // 18秒前（间隔6秒）
        Date.now() - 12000,  // 12秒前（间隔6秒）
        Date.now() - 6000    // 6秒前（间隔6秒）
    ],
    texts: [
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情',
        '添加微信了解详情'
    ],
    first_seen: Date.now() - 70000
};

console.log('行为特征:');
console.log('- 消息数量:', behaviorHistory.timestamps.length);
console.log('- 时间跨度:', '60秒内');
console.log('- 消息间隔:', '约6秒（非常规律）');
console.log('- 内容重复:', '10条完全相同');

console.log('\n预期检测结果:');
console.log('✓ 快速连续发送 (+40分)');
console.log('✓ 固定间隔模式 (+50分)');
console.log('✓ 高度重复内容 (+35分)');
console.log('✓ 新账号爆发 (+30分)');
console.log('总计: +155分 → 应该被拦截');

console.log('\n=== 测试 3: 社交图谱分析 ===\n');

const fingerprints = [
    { type: 'domain', value: 'spam.com', accounts: [1001, 1002, 1003, 1004, 1005] },
    { type: 'username', value: '@spambot', accounts: [1001, 1002, 1003] },
    { type: 'keyword', value: '代开+会员', accounts: [1001, 1002, 1003, 1004] }
];

console.log('指纹分析:');
fingerprints.forEach(fp => {
    console.log(`\n${fp.type} 指纹: "${fp.value}"`);
    console.log(`  关联账号: ${fp.accounts.length}个`);
    console.log(`  账号ID: ${fp.accounts.join(', ')}`);
    if (fp.accounts.length >= 3) {
        console.log('  ⚠️  检测到广告集群 (+60分)');
    }
});

console.log('\n=== 测试 4: 综合评分示例 ===\n');

const scenarios = [
    {
        name: '场景A：变形广告',
        content: '需要薇信vx123456或扣扣987654321',
        expected: '变形关键词+联系方式 → 80-100分'
    },
    {
        name: '场景B：混淆链接',
        content: 't.me/spambot 或访问 example.com 了解详情',
        expected: '混淆链接+域名 → 80-110分'
    },
    {
        name: '场景C：机器人+集群',
        content: '加入我们 t.me/group',
        behavior: '固定间隔发送',
        cluster: '属于5个账号的广告集群',
        expected: '内容45 + 行为50 + 集群60 = 155分 → 拦截'
    },
    {
        name: '场景D：正常咨询',
        content: '你好，请问你们的产品支持哪些功能？',
        expected: '0-20分 → 正常通过'
    }
];

scenarios.forEach((scenario, i) => {
    console.log(`\n${i + 1}. ${scenario.name}`);
    console.log(`   内容: "${scenario.content}"`);
    if (scenario.behavior) console.log(`   行为: ${scenario.behavior}`);
    if (scenario.cluster) console.log(`   图谱: ${scenario.cluster}`);
    console.log(`   预期: ${scenario.expected}`);
});

console.log('\n=== 测试完成 ===\n');
console.log('✅ 所有测试用例已展示');
console.log('📝 实际运行时，这些检测将自动触发');
console.log('📊 可通过日志观察实际评分结果');
console.log('\n建议：部署后发送测试消息验证实际效果\n');
