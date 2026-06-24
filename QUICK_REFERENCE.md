# 快速参考 - 新增防广告功能

## 🎯 三大新功能

### 1️⃣ 行为分析
识别机器人和批量发送行为
- 快速发送：30秒5条 → +40分
- 固定间隔：标准差<3秒 → +50分
- 重复内容：相似度>70% → +35分
- 新号爆发：5分钟8条 → +30分

### 2️⃣ 社交图谱
追踪关联账号和广告集群
- 账号集群：3个以上账号 → +60分
- 封禁关联：2个以上被封 → +70分

### 3️⃣ 智能关键词
识别变形和混淆的广告内容
- 拼音变形：薇信、vx、扣扣 → +25分/个
- 混淆链接：w w w . com → +30分
- Emoji隐写：规律性序列 → +30分

---

## 📊 风险评分

- **0-59分** → 正常通过
- **60-109分** → 进入审核
- **110-179分** → 直接拦截
- **180+分** → 自动封禁

---

## 🔧 常用配置

### 默认（平衡）
```javascript
SPAM_REVIEW_SCORE: 60
SPAM_BLOCK_SCORE: 110
SPAM_DIRECT_BAN_SCORE: 180
```

### 保守（减少误杀）
```javascript
SPAM_REVIEW_SCORE: 80
SPAM_BLOCK_SCORE: 140
SPAM_DIRECT_BAN_SCORE: 220
```

### 激进（严格防御）
```javascript
SPAM_REVIEW_SCORE: 50
SPAM_BLOCK_SCORE: 90
SPAM_DIRECT_BAN_SCORE: 150
```

---

## 🧪 快速测试

### 测试变形检测
```
发送：需要的加薇信：vx123456
预期：识别为可疑 → 审核/拦截
```

### 测试行为分析
```
快速发送8条消息（间隔5秒）
预期：触发行为检测 → +40-90分
```

### 测试正常消息
```
发送：你好，想咨询产品信息
预期：正常通过 → 不受影响
```

---

## 📝 重要日志

- `behavior_risk_detected` - 行为风险
- `social_cluster_detected` - 广告集群
- `variant_keywords_detected` - 变形关键词
- `spam_message_blocked` - 拦截统计

---

## 💡 管理建议

1. **初期**：使用默认配置，观察3天
2. **调整**：根据误判情况调整阈值
3. **信任**：对正常用户使用 `/trust`
4. **清理**：每月运行 `/cleanup`

---

## 📚 完整文档

- **ANTI_SPAM_UPGRADE.md** - 详细功能说明
- **DEPLOYMENT_CHECKLIST.md** - 部署指南
- **OPTIMIZATION_SUMMARY.md** - 优化总结

---

**v6.0 - 防广告能力提升 3-5 倍** 🚀
