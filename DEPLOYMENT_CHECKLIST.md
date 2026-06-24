# 部署检查清单

## ✅ 升级前准备

- [ ] 备份当前 `worker.js` 文件
- [ ] 导出现有环境变量配置
- [ ] 记录当前 KV 数据量（可选）
- [ ] 确认 Cloudflare Workers 配额充足

## 📦 部署步骤

### 方法 1: GitHub 集成部署（推荐）

1. **提交代码到 Git**
   ```bash
   cd telegram_private_chatbot
   git add worker.js
   git commit -m "升级到 v6.0: 新增行为分析、社交图谱、智能关键词检测"
   git push origin main
   ```

2. **Cloudflare 自动部署**
   - Cloudflare Pages 会自动检测到更新
   - 等待部署完成（通常 1-2 分钟）

3. **验证部署**
   ```bash
   # 检查 Worker 日志
   # Cloudflare Dashboard → Workers → 你的 Worker → Logs
   ```

### 方法 2: 手动部署

1. **登录 Cloudflare Dashboard**
   - 进入 Workers & Pages

2. **选择你的 Worker**
   - 点击 "Quick Edit" 或 "Edit Code"

3. **替换代码**
   - 复制新的 `worker.js` 内容
   - 粘贴到编辑器中
   - 点击 "Save and Deploy"

4. **等待部署完成**
   - 通常 10-30 秒

## ⚙️ 配置检查

- [ ] 确认 `BOT_TOKEN` 已设置
- [ ] 确认 `SUPERGROUP_ID` 已设置
- [ ] 确认 KV 命名空间 `TOPIC_MAP` 已绑定
- [ ] （可选）设置 `ADMIN_IDS` 环境变量

## 🧪 功能测试

### 测试 1: 变形关键词检测

发送测试消息到机器人：
```
需要的加薇信：vx123456
```

预期结果：
- ✅ 被识别为可疑消息
- ✅ 日志显示 `variant_keywords_detected`
- ✅ 进入审核或被拦截

### 测试 2: 行为分析

快速连续发送 8 条消息（间隔 5-10 秒）：
```
消息1
消息2
...
消息8
```

预期结果：
- ✅ 触发快速发送检测
- ✅ 日志显示 `behavior_risk_detected`
- ✅ 风险评分增加 40-90 分

### 测试 3: 社交图谱

使用不同账号发送包含相同域名的消息：
```
账号A: 访问 test-spam.com 了解详情
账号B: test-spam.com 有优惠活动
账号C: 联系 test-spam.com
```

预期结果：
- ✅ 系统识别为同一集群
- ✅ 日志显示 `social_cluster_detected`
- ✅ 后续账号发送该域名时风险分数更高

### 测试 4: 正常用户不受影响

发送正常消息：
```
你好，我想咨询一下你们的产品功能
```

预期结果：
- ✅ 正常通过
- ✅ 风险评分低于 60 分
- ✅ 消息成功转发到话题

## 📊 监控指标

### 重要日志事件

在 Cloudflare Workers Logs 中关注：

1. **behavior_risk_detected** - 行为风险检测
2. **social_cluster_detected** - 广告集群识别
3. **variant_keywords_detected** - 变形关键词检测
4. **spam_message_blocked** - 拦截统计
5. **spam_direct_banned_by_score** - 自动封禁

### 性能指标

- 平均响应时间：应 < 500ms
- KV 读取次数：每消息 +3-5 次
- CPU 使用时间：应 < 50ms

### 效果指标

部署后 24-48 小时观察：
- 拦截数量变化
- 误判率（通过审核队列）
- 用户投诉情况

## 🔧 故障排查

### 问题 1: 正常用户被频繁拦截

**症状：** 真实用户抱怨无法发送消息

**解决方案：**
```javascript
// 调整阈值（在 worker.js 中修改 CONFIG）
SPAM_REVIEW_SCORE: 80,  // 从 60 提高到 80
SPAM_BLOCK_SCORE: 140,  // 从 110 提高到 140
```

### 问题 2: 广告仍能通过

**症状：** 垃圾消息未被拦截

**排查步骤：**
1. 查看日志中的评分详情
2. 检查是否触发了变形检测
3. 确认域名/用户名是否在白名单中

**解决方案：**
```javascript
// 降低阈值
SPAM_REVIEW_SCORE: 50,  // 从 60 降低到 50
SPAM_BLOCK_SCORE: 90,   // 从 110 降低到 90

// 或手动添加黑名单
BLOCKED_DOMAINS: "spam.com,bad.net"
```

### 问题 3: Worker 超时

**症状：** 部分请求返回 524 错误

**解决方案：**
```javascript
// 减少历史记录
BEHAVIOR_HISTORY_MAX: 10,  // 从 20 减少到 10

// 跳过集群检查（临时）
SOCIAL_CLUSTER_SCORE_BOOST: 0,  // 禁用集群检测
```

### 问题 4: KV 配额不足

**症状：** 提示 KV 写入限制

**解决方案：**
```javascript
// 缩短 TTL
BEHAVIOR_TRACKING_WINDOW: 180,  // 从 300 秒减少到 180 秒
SOCIAL_FINGERPRINT_TTL_SECONDS: 259200,  // 从 7 天减少到 3 天
```

## 🔄 回滚方案

如果新版本出现严重问题：

1. **快速回滚**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **或手动恢复**
   - 在 Cloudflare Dashboard 中
   - Workers → 你的 Worker → Deployments
   - 选择之前的部署版本
   - 点击 "Rollback to this version"

## 📈 优化建议

### 1 周后

- [ ] 查看拦截统计
- [ ] 分析误判案例
- [ ] 调整评分权重
- [ ] 补充新的变形关键词

### 1 个月后

- [ ] 评估整体效果
- [ ] 清理无效的社交图谱数据（`/cleanup`）
- [ ] 更新黑名单列表
- [ ] 考虑是否需要进一步优化

## 🎯 成功标准

部署成功的标志：

✅ **功能正常**
- 正常用户能正常发送消息
- 验证流程没有中断
- 管理员命令正常工作

✅ **防广告有效**
- 广告拦截率提升
- 变形广告被成功识别
- 批量账号被关联识别

✅ **性能稳定**
- 响应时间在可接受范围
- 没有频繁超时
- KV 配额充足

✅ **误判可控**
- 误判率 < 5%
- 审核队列可管理
- 用户投诉减少

## 📞 获取支持

如遇到问题：

1. 查看日志分析问题原因
2. 参考 `ANTI_SPAM_UPGRADE.md` 文档
3. 在 GitHub Issues 中报告问题
4. 提供详细的日志和错误信息

---

**祝部署顺利！🎉**
