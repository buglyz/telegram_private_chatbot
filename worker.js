// Cloudflare Worker：Telegram 双向机器人 v5.3

// --- 配置常量 ---
const CONFIG = {
    VERIFY_ID_LENGTH: 12,
    VERIFY_EXPIRE_SECONDS: 300,         // 5分钟
    VERIFY_MAX_ATTEMPTS: 2,
    VERIFY_FAIL_COOLDOWN_SECONDS: 300,  // 5分钟
    VERIFIED_EXPIRE_SECONDS: 604800,    // 7天
    UNTRUSTED_OBSERVATION_SECONDS: 86400, // 普通验证后 24 小时观察期
    FIRST_MESSAGES_RESTRICTED_COUNT: 3, // 普通用户前 3 条正常消息禁止链接和 @
    FORWARD_PENDING_AFTER_VERIFY: false, // 验证前消息不自动转发，降低广告首条直达风险
    MEDIA_GROUP_EXPIRE_SECONDS: 60,
    MEDIA_GROUP_DELAY_MS: 3000,         // 3秒（从2秒增加）
    PENDING_MAX_MESSAGES: 10,           // 验证期间最多暂存的消息数
    ADMIN_CACHE_TTL_SECONDS: 300,       // 管理员权限缓存 5 分钟
    NEEDS_REVERIFY_TTL_SECONDS: 600,    // 标记需重新验证的 TTL（用于并发兜底）
    RATE_LIMIT_MESSAGE: 45,
    RATE_LIMIT_VERIFY: 3,
    RATE_LIMIT_WINDOW: 60,
    BUTTON_COLUMNS: 2,
    MAX_TITLE_LENGTH: 128,
    MAX_NAME_LENGTH: 30,
    API_TIMEOUT_MS: 10000,
    CLEANUP_BATCH_SIZE: 10,
    MAX_CLEANUP_DISPLAY: 20,
    CLEANUP_LOCK_TTL_SECONDS: 1800,     // /cleanup 防并发锁 30 分钟
    MAX_RETRY_ATTEMPTS: 3,
    THREAD_HEALTH_TTL_MS: 60000,
    SPAM_REVIEW_SCORE: 60,
    SPAM_BLOCK_SCORE: 110,
    SPAM_AUTO_BAN_HITS: 3,
    SPAM_HIT_TTL_SECONDS: 86400,
    FIRST_REJECT_AUTO_BAN_HITS: 5,
    FIRST_REJECT_HIT_TTL_SECONDS: 86400,
    CAMPAIGN_REVIEW_HITS: 3,
    CAMPAIGN_BLOCK_HITS: 5,
    CAMPAIGN_TTL_SECONDS: 86400,
    SPAM_PREVIEW_LENGTH: 600,
    DEFAULT_BLOCKED_DOMAINS: [
        "pandaonline.world",
        "dwgan9.vip"
    ],
    DEFAULT_BLOCKED_USERNAMES: [
        "hlmdfgg",
        "fzdn1",
        "fzdn6",
        "zulinx5bot",
        "bmwx5",
        "linkedinqyx5",
        "bmw4x",
        "linkedinqyqy",
        "jiuhao_bbbot",
        "trx20sbot",
        "so_trxbot",
        "ajiao010",
        "ajiao01bot",
        "jinghua3",
        "anycastvpn1",
        "mk888bot"
    ]
};

// 线程健康检查缓存，减少频繁探测请求
const threadHealthCache = new Map();
// 同一实例内的并发保护：避免同一用户短时间内重复创建话题
const topicCreateInFlight = new Map();
// 管理员权限缓存（实例内）
const adminStatusCache = new Map();

// --- 本地题库 (15条) ---
const LOCAL_QUESTIONS = [
    {"question": "冰融化后会变成什么？", "correct_answer": "水", "incorrect_answers": ["石头", "木头", "火"]},
    {"question": "正常人有几只眼睛？", "correct_answer": "2", "incorrect_answers": ["1", "3", "4"]},
    {"question": "以下哪个属于水果？", "correct_answer": "香蕉", "incorrect_answers": ["白菜", "猪肉", "大米"]},
    {"question": "1 加 2 等于几？", "correct_answer": "3", "incorrect_answers": ["2", "4", "5"]},
    {"question": "5 减 2 等于几？", "correct_answer": "3", "incorrect_answers": ["1", "2", "4"]},
    {"question": "2 乘以 3 等于几？", "correct_answer": "6", "incorrect_answers": ["4", "5", "7"]},
    {"question": "10 加 5 等于几？", "correct_answer": "15", "incorrect_answers": ["10", "12", "20"]},
    {"question": "8 减 4 等于几？", "correct_answer": "4", "incorrect_answers": ["2", "3", "5"]},
    {"question": "在天上飞的交通工具是什么？", "correct_answer": "飞机", "incorrect_answers": ["汽车", "轮船", "自行车"]},
    {"question": "星期一的后面是星期几？", "correct_answer": "星期二", "incorrect_answers": ["星期日", "星期五", "星期三"]},
    {"question": "鱼通常生活在哪里？", "correct_answer": "水里", "incorrect_answers": ["树上", "土里", "火里"]},
    {"question": "我们用什么器官来听声音？", "correct_answer": "耳朵", "incorrect_answers": ["眼睛", "鼻子", "嘴巴"]},
    {"question": "晴朗的天空通常是什么颜色的？", "correct_answer": "蓝色", "incorrect_answers": ["绿色", "红色", "紫色"]},
    {"question": "太阳从哪个方向升起？", "correct_answer": "东方", "incorrect_answers": ["西方", "南方", "北方"]},
    {"question": "小狗发出的叫声通常是？", "correct_answer": "汪汪", "incorrect_answers": ["喵喵", "咩咩", "呱呱"]}
];

// --- 辅助工具函数 ---

// 结构化日志系统
const Logger = {
    /**
     * 记录信息级别日志
     * @param {string} action - 操作名称
     * @param {object} data - 附加数据
     */
    info(action, data = {}) {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            action,
            ...data
        };
        console.log(JSON.stringify(log));
    },

    /**
     * 记录警告级别日志
     * @param {string} action - 操作名称
     * @param {object} data - 附加数据
     */
    warn(action, data = {}) {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'WARN',
            action,
            ...data
        };
        console.warn(JSON.stringify(log));
    },

    /**
     * 记录错误级别日志
     * @param {string} action - 操作名称
     * @param {Error|string} error - 错误对象或消息
     * @param {object} data - 附加数据
     */
    error(action, error, data = {}) {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            action,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            ...data
        };
        console.error(JSON.stringify(log));
    },

    /**
     * 记录调试级别日志
     * @param {string} action - 操作名称
     * @param {object} data - 附加数据
     */
    debug(action, data = {}) {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'DEBUG',
            action,
            ...data
        };
        console.log(JSON.stringify(log));
    }
};

// 加密安全的随机数生成
function secureRandomInt(min, max) {
    const range = max - min;
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return min + (bytes[0] % range);
}

function secureRandomId(length = 12) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

// 安全的 JSON 获取
async function safeGetJSON(env, key, defaultValue = null) {
    try {
        const data = await env.TOPIC_MAP.get(key, { type: "json" });
        if (data === null || data === undefined) {
            return defaultValue;
        }
        if (typeof data !== 'object') {
            Logger.warn('kv_invalid_type', { key, type: typeof data });
            return defaultValue;
        }
        return data;
    } catch (e) {
        Logger.error('kv_parse_failed', e, { key });
        return defaultValue;
    }
}

function normalizeTgDescription(description) {
    return (description || "").toString().toLowerCase();
}

function isTopicMissingOrDeleted(description) {
    const desc = normalizeTgDescription(description);
    return desc.includes("thread not found") ||
           desc.includes("topic not found") ||
           desc.includes("message thread not found") ||
           desc.includes("topic deleted") ||
           desc.includes("thread deleted") ||
           desc.includes("forum topic not found") ||
           desc.includes("topic closed permanently");
}

function isTestMessageInvalid(description) {
    const desc = normalizeTgDescription(description);
    return desc.includes("message text is empty") ||
           desc.includes("bad request: message text is empty");
}

async function getOrCreateUserTopicRec(from, key, env, userId) {
    const existing = await safeGetJSON(env, key, null);
    if (existing && existing.thread_id) return existing;

    const inflight = topicCreateInFlight.get(String(userId));
    if (inflight) return await inflight;

    const p = (async () => {
        // 并发下二次确认，避免已被其他请求创建却读到旧值
        const again = await safeGetJSON(env, key, null);
        if (again && again.thread_id) return again;
        return await createTopic(from, key, env, userId);
    })();

    topicCreateInFlight.set(String(userId), p);
    try {
        return await p;
    } finally {
        if (topicCreateInFlight.get(String(userId)) === p) {
            topicCreateInFlight.delete(String(userId));
        }
    }
}

function withMessageThreadId(body, threadId) {
    if (threadId === undefined || threadId === null) return body;
    return { ...body, message_thread_id: threadId };
}

async function probeForumThread(env, expectedThreadId, { userId, reason, doubleCheckOnMissingThreadId = true } = {}) {
    const attemptOnce = async () => {
        const res = await tgCall(env, "sendMessage", {
            chat_id: env.SUPERGROUP_ID,
            message_thread_id: expectedThreadId,
            text: "🔎"
        });

        const actualThreadId = res.result?.message_thread_id;
        const probeMessageId = res.result?.message_id;

        // 尽可能清理探测消息（无论落到哪个话题/General）
        if (res.ok && probeMessageId) {
            try {
                await tgCall(env, "deleteMessage", {
                    chat_id: env.SUPERGROUP_ID,
                    message_id: probeMessageId
                });
            } catch (e) {
                // 删除失败不影响主流程
            }
        }

        if (!res.ok) {
            if (isTopicMissingOrDeleted(res.description)) {
                return { status: "missing", description: res.description };
            }
            if (isTestMessageInvalid(res.description)) {
                return { status: "probe_invalid", description: res.description };
            }
            return { status: "unknown_error", description: res.description };
        }

        // 关键：有些情况下 Telegram 会返回 ok 但不带 message_thread_id（常见于 General）
        if (actualThreadId === undefined || actualThreadId === null) {
            return { status: "missing_thread_id" };
        }

        if (Number(actualThreadId) !== Number(expectedThreadId)) {
            return { status: "redirected", actualThreadId };
        }

        return { status: "ok" };
    };

    const first = await attemptOnce();
    if (first.status !== "missing_thread_id" || !doubleCheckOnMissingThreadId) return first;

    // 二次探测：避免偶发字段缺失导致误判并触发重建
    const second = await attemptOnce();
    if (second.status === "missing_thread_id") {
        Logger.warn('thread_probe_missing_thread_id', { userId, expectedThreadId, reason });
    }
    return second;
}

async function resetUserVerificationAndRequireReverify(env, { userId, userKey, oldThreadId, pendingMsgId, reason }) {
    // 清理旧映射与验证状态：用户需要重新做人机验证
    await env.TOPIC_MAP.delete(`verified:${userId}`);
    await env.TOPIC_MAP.delete(`observation:${userId}`);
    await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
    await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
    await env.TOPIC_MAP.put(`needs_verify:${userId}`, "1", { expirationTtl: CONFIG.NEEDS_REVERIFY_TTL_SECONDS });
    await env.TOPIC_MAP.delete(`retry:${userId}`);

    if (userKey) {
        await env.TOPIC_MAP.delete(userKey);
    }

    if (oldThreadId !== undefined && oldThreadId !== null) {
        await env.TOPIC_MAP.delete(`thread:${oldThreadId}`);
        await env.TOPIC_MAP.delete(`thread_ok:${oldThreadId}`);
        threadHealthCache.delete(oldThreadId);
    }

    Logger.info('verification_reset_due_to_topic_loss', {
        userId,
        oldThreadId,
        pendingMsgId,
        reason
    });

    await sendVerificationChallenge(userId, env, pendingMsgId || null);
}

function parseAdminIdAllowlist(env) {
    const raw = (env.ADMIN_IDS || "").toString().trim();
    if (!raw) return null;
    const ids = raw.split(/[,;\s]+/g).map(s => s.trim()).filter(Boolean);
    const set = new Set();
    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        set.add(String(n));
    }
    return set.size > 0 ? set : null;
}

async function isAdminUser(env, userId) {
    const allowlist = parseAdminIdAllowlist(env);
    if (allowlist && allowlist.has(String(userId))) return true;

    const cacheKey = String(userId);
    const now = Date.now();
    const cached = adminStatusCache.get(cacheKey);
    if (cached && (now - cached.ts < CONFIG.ADMIN_CACHE_TTL_SECONDS * 1000)) {
        return cached.isAdmin;
    }

    const kvKey = `admin:${userId}`;
    const kvVal = await env.TOPIC_MAP.get(kvKey);
    if (kvVal === "1" || kvVal === "0") {
        const isAdmin = kvVal === "1";
        adminStatusCache.set(cacheKey, { ts: now, isAdmin });
        return isAdmin;
    }

    try {
        const res = await tgCall(env, "getChatMember", {
            chat_id: env.SUPERGROUP_ID,
            user_id: userId
        });

        const status = res.result?.status;
        const isAdmin = res.ok && (status === "creator" || status === "administrator");
        await env.TOPIC_MAP.put(kvKey, isAdmin ? "1" : "0", { expirationTtl: CONFIG.ADMIN_CACHE_TTL_SECONDS });
        adminStatusCache.set(cacheKey, { ts: now, isAdmin });
        return isAdmin;
    } catch (e) {
        Logger.warn('admin_check_failed', { userId });
        return false;
    }
}

// 获取所有 KV keys（处理分页）
async function getAllKeys(env, prefix) {
    const allKeys = [];
    let cursor = undefined;

    do {
        const result = await env.TOPIC_MAP.list({ prefix, cursor });
        allKeys.push(...result.keys);
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return allKeys;
}

// Fisher-Yates 洗牌算法
function shuffleArray(arr) {
    const array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
        const j = secureRandomInt(0, i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 速率限制检查
async function checkRateLimit(userId, env, action = 'message', limit = 20, window = 60) {
    const key = `ratelimit:${action}:${userId}`;
    const countStr = await env.TOPIC_MAP.get(key);
    const count = parseInt(countStr || "0");

    if (count >= limit) {
        return { allowed: false, remaining: 0 };
    }

    await env.TOPIC_MAP.put(key, String(count + 1), { expirationTtl: window });
    return { allowed: true, remaining: limit - count - 1 };
}

function getMessageTextForScan(msg) {
    const parts = [];
    if (msg.text) parts.push(msg.text);
    if (msg.caption) parts.push(msg.caption);
    if (msg.document?.file_name) parts.push(msg.document.file_name);
    if (msg.contact?.phone_number) parts.push(msg.contact.phone_number);
    if (msg.contact?.first_name) parts.push(msg.contact.first_name);
    if (msg.contact?.last_name) parts.push(msg.contact.last_name);
    return parts.join("\n");
}

function getMessageEntities(msg) {
    return [
        ...(Array.isArray(msg.entities) ? msg.entities : []),
        ...(Array.isArray(msg.caption_entities) ? msg.caption_entities : [])
    ];
}

function normalizeSpamText(text) {
    return (text || "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function hasMessageMedia(msg) {
    return !!(
        msg.photo || msg.video || msg.document || msg.animation ||
        msg.audio || msg.voice || msg.video_note || msg.sticker
    );
}

function hasForwardSignal(msg) {
    return !!(
        msg.forward_origin || msg.forward_from || msg.forward_from_chat ||
        msg.forward_sender_name || msg.forward_date
    );
}

function describeMessageTypes(msg) {
    const types = [];
    if (msg.text) types.push("text");
    if (msg.caption) types.push("caption");
    if (msg.photo) types.push("photo");
    if (msg.video) types.push("video");
    if (msg.document) types.push("document");
    if (msg.animation) types.push("animation");
    if (msg.audio) types.push("audio");
    if (msg.voice) types.push("voice");
    if (msg.video_note) types.push("video_note");
    if (msg.sticker) types.push("sticker");
    if (msg.contact) types.push("contact");
    if (msg.location || msg.venue) types.push("location");
    if (hasForwardSignal(msg)) types.push("forwarded");
    return types.length ? types.join(", ") : "unknown";
}

function parseEnvSet(raw) {
    const value = (raw || "").toString().trim().toLowerCase();
    if (!value) return new Set();
    return new Set(
        value
            .split(/[,;\s]+/g)
            .map(item => item.trim())
            .filter(Boolean)
            .map(item => item.replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    );
}

function mergeSets(...sets) {
    const merged = new Set();
    for (const set of sets) {
        for (const item of set) merged.add(item);
    }
    return merged;
}

function normalizeDomain(value) {
    const domain = (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split(/[/?#]/)[0]
        .replace(/:\d+$/, "");

    if (!domain || !domain.includes(".")) return null;
    if (!/^[a-z0-9.-]+$/.test(domain)) return null;
    return domain;
}

function extractDomainsFromMatches(matches) {
    const domains = new Set();
    for (const match of matches) {
        const domain = normalizeDomain(match);
        if (domain) domains.add(domain);
    }
    return [...domains];
}

function domainMatchesPolicy(domain, policySet) {
    if (!domain || !policySet || policySet.size === 0) return false;
    for (const item of policySet) {
        if (domain === item || domain.endsWith(`.${item}`)) return true;
    }
    return false;
}

function usernameMatchesPolicy(username, policySet) {
    if (!username || !policySet || policySet.size === 0) return false;
    return policySet.has(username.toLowerCase().replace(/^@/, ""));
}

function getSpamPolicy(env, risk) {
    const defaultBlockedDomains = parseEnvSet((CONFIG.DEFAULT_BLOCKED_DOMAINS || []).join(","));
    const defaultBlockedUsernames = parseEnvSet((CONFIG.DEFAULT_BLOCKED_USERNAMES || []).join(","));
    const blockedDomains = mergeSets(defaultBlockedDomains, parseEnvSet(env.BLOCKED_DOMAINS || env.SPAM_BLOCKED_DOMAINS));
    const allowedDomains = parseEnvSet(env.ALLOWED_DOMAINS || env.SPAM_ALLOWED_DOMAINS);
    const blockedUsernames = mergeSets(defaultBlockedUsernames, parseEnvSet(env.BLOCKED_USERNAMES || env.SPAM_BLOCKED_USERNAMES));
    const allowedUsernames = parseEnvSet(env.ALLOWED_USERNAMES || env.SPAM_ALLOWED_USERNAMES);

    const domains = risk.features.domains || [];
    const usernames = risk.features.usernames || [];
    const blockedDomain = domains.find(domain => domainMatchesPolicy(domain, blockedDomains));
    const blockedUsername = usernames.find(username => usernameMatchesPolicy(username, blockedUsernames));
    const hasDomains = domains.length > 0;
    const hasUsernames = usernames.length > 0;
    const allDomainsAllowed = hasDomains && domains.every(domain => domainMatchesPolicy(domain, allowedDomains));
    const allUsernamesAllowed = hasUsernames && usernames.every(username => usernameMatchesPolicy(username, allowedUsernames));

    return {
        blockedDomain,
        blockedUsername,
        allDomainsAllowed,
        allUsernamesAllowed
    };
}

function addRiskReason(risk, points, reason) {
    risk.score += points;
    if (!risk.reasons.includes(reason)) risk.reasons.push(reason);
}

function scoreSpamMessage(msg, { inObservation = false, isFirstThread = false } = {}) {
    const rawText = getMessageTextForScan(msg);
    const text = normalizeSpamText(rawText);
    const entities = getMessageEntities(msg);
    const reasons = [];
    let score = 0;

    const add = (points, reason) => {
        score += points;
        if (!reasons.includes(reason)) reasons.push(reason);
    };

    const entityTypes = new Set(entities.map(e => e.type).filter(Boolean));
    const hasLinkEntity = entityTypes.has("url") || entityTypes.has("text_link");
    const hasContactEntity = entityTypes.has("mention") || entityTypes.has("email") || entityTypes.has("phone_number");
    const entityUrls = entities.map(e => e.url).filter(Boolean);
    const urlMatches = [
        ...(text.match(/(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/|wa\.me\/|discord\.gg\/|bit\.ly\/|tinyurl\.com\/|linktr\.ee\/|(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|cc|xyz|top|shop|site|vip|club|info|pro|app|cn|ru|tv|live)\b)/gi) || []),
        ...entityUrls
    ];
    const mentionMatches = text.match(/@[a-z0-9_]{4,}/gi) || [];
    const domains = extractDomainsFromMatches(urlMatches);
    const usernames = [...new Set(mentionMatches.map(name => name.toLowerCase().replace(/^@/, "")))];
    const hasObfuscatedLink = /(?:h\s*t\s*t\s*p|w\s*w\s*w\s*\.|t\s*[\.\-_/ ]\s*me|telegram\s*[\.\-_/ ]\s*me|dot\s*com)/i.test(text);
    const hasPhoneOrEmail = /(?:\+?\d[\d\s\-().]{7,}\d)|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
    const hasContactKeyword = /(微信|微\s*信|薇信|vx|v信|qq|whatsapp|line|skype|纸飞机|飞机号|电报|tg[:：]?|私聊|加群|群组|频道|扫码|二维码)/i.test(text);
    const strongSpamKeywords = [
        "嫖娼", "萝莉", "裸聊", "约炮", "同城约", "博彩", "投注", "体育投注",
        "群发器", "自动批量群发", "代打广告", "炸频道", "僵尸粉", "购买飞机号",
        "能量租赁", "trx", "usdt", "会员代开", "会员直充", "开元娱乐", "反水"
    ];
    const spamKeywords = [
        "返佣", "兼职", "刷单", "贷款", "代开", "代充", "空投", "撸毛", "引流", "涨粉",
        "成人", "色情", "出售", "推广", "代发", "跑量", "广告群组", "全国广告群组",
        "浏览量", "点赞", "消极表情", "破解版", "彩虹群发", "超级群发", "买粉",
        "飞机号", "飞机会员", "业务导航", "在线下单", "先做单后付款", "搜索引擎排名",
        "vpn", "代理", "流量交流", "转账手续费", "闪兑", "注册送", "注册即送", "秒杀低价",
        "发财", "福利多多", "全网最低价", "全网好用便宜"
    ];
    const strongKeywordHits = strongSpamKeywords.filter(word => text.includes(word));
    const keywordHits = spamKeywords.filter(word => text.includes(word));
    const hasMedia = hasMessageMedia(msg);
    const hasForward = hasForwardSignal(msg);
    const hasLink = hasLinkEntity || urlMatches.length > 0 || hasObfuscatedLink;
    const hasMention = entityTypes.has("mention") || mentionMatches.length > 0;
    const hasContact = hasContactEntity || mentionMatches.length > 0 || hasPhoneOrEmail || hasContactKeyword || !!msg.contact;

    if (msg.from?.is_bot) add(100, "bot_sender");
    if (hasLinkEntity) add(urlMatches.length > 0 ? 15 : 40, "telegram_link_entity");
    if (urlMatches.length > 0) add(45, "url_or_domain");
    if (hasObfuscatedLink) add(35, "obfuscated_link");
    if (mentionMatches.length > 0) add(18, "username_mention");
    if (hasPhoneOrEmail) add(22, "phone_or_email");
    if (hasContactKeyword) add(18, "contact_keyword");
    if (strongKeywordHits.length > 0) add(Math.min(85, strongKeywordHits.length * 35), "strong_spam_keywords");
    if (keywordHits.length > 0) add(Math.min(55, keywordHits.length * 18), "spam_keywords");
    if (hasForward) add(25, "forwarded_message");
    if (hasMedia) add(msg.document ? 25 : 15, "media_or_file");
    if (msg.contact || msg.location || msg.venue) add(30, "contact_or_location_payload");
    if ((urlMatches.length + mentionMatches.length) >= 3) add(20, "many_links_or_mentions");
    if (text.length > 280 && (hasLink || hasContact || keywordHits.length > 0 || strongKeywordHits.length > 0)) add(25, "long_ad_like_message");
    if ((text.match(/[👉🔥⚡️📝]/g) || []).length >= 3 && (hasLink || hasContact)) add(20, "ad_emoji_layout");
    if (text.length > 0 && text.length < 18 && (hasLink || hasContact)) add(15, "short_contact_message");
    if (inObservation && hasLink) add(25, "observation_link");
    if (inObservation && hasMedia) add(30, "observation_media");
    if (inObservation && hasForward) add(30, "observation_forward");
    if (inObservation && hasContact) add(20, "observation_contact");
    if (isFirstThread && (hasLink || hasMedia || hasForward || hasContact)) add(15, "first_message_restricted");

    return {
        score,
        reasons,
        features: {
            hasLink,
            hasMention,
            hasMedia,
            hasForward,
            hasContact,
            hasSpamKeyword: keywordHits.length > 0 || strongKeywordHits.length > 0,
            domains,
            usernames
        }
    };
}

function sanitizeSpamPreview(text) {
    const raw = (text || "[非文本消息]").replace(/\s+/g, " ").trim();
    return raw
        .replace(/https?:\/\//gi, "hxxp://")
        .replace(/\bt\.me\b/gi, "t[.]me")
        .replace(/\btelegram\.me\b/gi, "telegram[.]me")
        .replace(/\b([a-z0-9-]+\.)+(com|net|org|io|me|cc|xyz|top|shop|site|vip|club|info|pro|app|cn|ru|tv|live)\b/gi, domain => domain.replace(/\./g, "[.]"))
        .replace(/@([a-z0-9_]{4,})/gi, "@ $1")
        .substring(0, CONFIG.SPAM_PREVIEW_LENGTH);
}

function buildSuspiciousMessageNotice(userId, msg, risk, action) {
    const from = msg.from || {};
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || "User";
    const username = from.username ? `@${from.username}` : "无";
    const actionText = action === "block" ? "已拦截" : "已进入审核";
    const reasons = risk.reasons.length ? risk.reasons.join(", ") : "unknown";
    const preview = sanitizeSpamPreview(getMessageTextForScan(msg));

    return [
        `⚠️ 可疑私聊${actionText}`,
        "",
        `UID: ${userId}`,
        `用户: ${name}`,
        `Username: ${username}`,
        `风险分: ${risk.score}`,
        `原因: ${reasons}`,
        `消息类型: ${describeMessageTypes(msg)}`,
        "",
        "预览:",
        preview
    ].join("\n");
}

async function recordSpamHit(env, userId) {
    const key = `spam_hits:${userId}`;
    const count = parseInt(await env.TOPIC_MAP.get(key) || "0") + 1;
    await env.TOPIC_MAP.put(key, String(count), { expirationTtl: CONFIG.SPAM_HIT_TTL_SECONDS });
    if (count >= CONFIG.SPAM_AUTO_BAN_HITS) {
        await env.TOPIC_MAP.put(`banned:${userId}`, "1");
        await env.TOPIC_MAP.delete(`verified:${userId}`);
        await env.TOPIC_MAP.delete(`observation:${userId}`);
        await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
        await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
    }
    return count;
}

async function recordFirstRejectHit(env, userId) {
    const key = `first_reject_hits:${userId}`;
    const count = parseInt(await env.TOPIC_MAP.get(key) || "0") + 1;
    await env.TOPIC_MAP.put(key, String(count), { expirationTtl: CONFIG.FIRST_REJECT_HIT_TTL_SECONDS });
    if (count >= CONFIG.FIRST_REJECT_AUTO_BAN_HITS) {
        await env.TOPIC_MAP.put(`banned:${userId}`, "1");
        await env.TOPIC_MAP.delete(`verified:${userId}`);
        await env.TOPIC_MAP.delete(`observation:${userId}`);
        await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
        await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
    }
    return count;
}

async function getAllowedMessageCount(env, userId) {
    return parseInt(await env.TOPIC_MAP.get(`allowed_msg_count:${userId}`) || "0");
}

async function incrementAllowedMessageCount(env, userId, verified) {
    if (verified === "trusted") return;
    const key = `allowed_msg_count:${userId}`;
    const count = await getAllowedMessageCount(env, userId);
    if (count >= CONFIG.FIRST_MESSAGES_RESTRICTED_COUNT) return;
    await env.TOPIC_MAP.put(key, String(count + 1), { expirationTtl: CONFIG.VERIFIED_EXPIRE_SECONDS });
}

async function sha256Hex(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildCampaignFingerprintText(msg, risk) {
    const text = normalizeSpamText(getMessageTextForScan(msg))
        .replace(/https?:\/\/\S+/g, "<url>")
        .replace(/\bwww\.\S+/g, "<url>")
        .replace(/\b[a-z0-9-]+\.(com|net|org|io|me|cc|xyz|top|shop|site|vip|club|info|pro|app|cn|ru|tv|live)\b/g, "<domain>")
        .replace(/@[a-z0-9_]{4,}/g, "<username>")
        .replace(/\+?\d[\d\s\-().]{7,}\d/g, "<phone>")
        .substring(0, 700);

    const hasCampaignSignal =
        risk.features.hasLink ||
        risk.features.hasContact ||
        risk.features.hasSpamKeyword ||
        risk.features.hasForward ||
        risk.features.hasMedia;

    if (!hasCampaignSignal) return null;
    if (text.length < 16 && !risk.features.hasMedia) return null;
    return text || describeMessageTypes(msg);
}

async function trackCampaignFingerprint(env, userId, msg, risk) {
    const fingerprintText = buildCampaignFingerprintText(msg, risk);
    if (!fingerprintText) return null;

    const hash = await sha256Hex(fingerprintText);
    const key = `campaign:${hash}`;
    const count = parseInt(await env.TOPIC_MAP.get(key) || "0") + 1;
    await env.TOPIC_MAP.put(key, String(count), { expirationTtl: CONFIG.CAMPAIGN_TTL_SECONDS });

    Logger.debug('campaign_fingerprint_seen', {
        userId,
        hash: hash.slice(0, 12),
        count
    });

    return { hash: hash.slice(0, 12), count };
}

async function notifyUserFirstMessagesRestriction(env, userId, remaining) {
    const key = `first_reject_notice:${userId}`;
    const alreadySent = await env.TOPIC_MAP.get(key);
    if (alreadySent) return;
    await env.TOPIC_MAP.put(key, "1", { expirationTtl: 60 });
    await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: `⚠️ 为防止广告，新用户前 ${CONFIG.FIRST_MESSAGES_RESTRICTED_COUNT} 条消息不能包含链接或 @用户名。请先用普通文字说明来意。还需 ${remaining} 条普通消息后解除此限制。`
    });
}

async function notifyUserReviewOnce(env, userId) {
    const key = `review_notice:${userId}`;
    const alreadySent = await env.TOPIC_MAP.get(key);
    if (alreadySent) return;
    await env.TOPIC_MAP.put(key, "1", { expirationTtl: 60 });
    await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: "⚠️ 这条消息已进入人工审核。新用户请先用文字说明来意，暂不要发送链接、二维码、联系方式或文件。"
    });
}

async function quarantineSuspiciousMessage(msg, userId, key, env, risk, action = "review") {
    const rec = await getOrCreateUserTopicRec(msg.from || { first_name: "User" }, key, env, userId);
    await tgCall(env, "sendMessage", {
        chat_id: env.SUPERGROUP_ID,
        message_thread_id: rec.thread_id,
        text: buildSuspiciousMessageNotice(userId, msg, risk, action)
    });
}

async function moderatePrivateMessage(msg, userId, key, verified, env) {
    if (verified === "trusted") {
        return { action: "allow" };
    }

    const rec = await safeGetJSON(env, key, null);
    const observation = await env.TOPIC_MAP.get(`observation:${userId}`);
    const isFirstThread = !rec || !rec.thread_id;
    const inObservation = !!observation || isFirstThread;
    const risk = scoreSpamMessage(msg, { inObservation, isFirstThread });
    const policy = getSpamPolicy(env, risk);
    const allowedCount = await getAllowedMessageCount(env, userId);
    const inFirstRestrictedMessages = allowedCount < CONFIG.FIRST_MESSAGES_RESTRICTED_COUNT;
    const restrictedLink = risk.features.hasLink && !policy.allDomainsAllowed;
    const restrictedMention = risk.features.hasMention && !policy.allUsernamesAllowed;
    const firstMessagesRestricted =
        inFirstRestrictedMessages &&
        (restrictedLink || restrictedMention);
    const observationRestricted =
        inObservation &&
        (risk.features.hasLink || risk.features.hasMedia || risk.features.hasForward || risk.features.hasContact);

    if (policy.blockedDomain || policy.blockedUsername) {
        const reason = policy.blockedDomain ? `blocked_domain:${policy.blockedDomain}` : `blocked_username:${policy.blockedUsername}`;
        addRiskReason(risk, CONFIG.SPAM_BLOCK_SCORE, reason);
        const hitCount = await recordSpamHit(env, userId);
        Logger.warn('spam_policy_blocked', {
            userId,
            reason,
            score: risk.score,
            hitCount
        });
        return { action: "block", risk, hitCount };
    }

    if (firstMessagesRestricted) {
        const rejectHits = await recordFirstRejectHit(env, userId);
        Logger.warn('first_messages_link_or_mention_rejected', {
            userId,
            allowedCount,
            score: risk.score,
            reasons: risk.reasons,
            rejectHits
        });
        return {
            action: "first_reject",
            risk,
            remaining: CONFIG.FIRST_MESSAGES_RESTRICTED_COUNT - allowedCount,
            rejectHits,
            banned: rejectHits >= CONFIG.FIRST_REJECT_AUTO_BAN_HITS
        };
    }

    const campaign = await trackCampaignFingerprint(env, userId, msg, risk);
    if (campaign && campaign.count >= CONFIG.CAMPAIGN_BLOCK_HITS) {
        addRiskReason(risk, CONFIG.SPAM_BLOCK_SCORE, `duplicate_campaign:${campaign.count}`);
        const hitCount = await recordSpamHit(env, userId);
        Logger.warn('spam_campaign_blocked', {
            userId,
            campaign,
            score: risk.score,
            reasons: risk.reasons,
            hitCount
        });
        return { action: "block", risk, hitCount };
    }

    let campaignReview = false;
    if (campaign && campaign.count >= CONFIG.CAMPAIGN_REVIEW_HITS) {
        addRiskReason(risk, 0, `duplicate_campaign:${campaign.count}`);
        campaignReview = true;
    }

    if (risk.score >= CONFIG.SPAM_BLOCK_SCORE) {
        const hitCount = await recordSpamHit(env, userId);
        Logger.warn('spam_message_blocked', {
            userId,
            score: risk.score,
            reasons: risk.reasons,
            hitCount
        });
        return { action: "block", risk, hitCount };
    }

    if (observationRestricted || campaignReview || risk.score >= CONFIG.SPAM_REVIEW_SCORE) {
        Logger.warn('spam_message_quarantined', {
            userId,
            score: risk.score,
            reasons: risk.reasons,
            observationRestricted
        });
        return { action: "review", risk };
    }

    return { action: "allow", risk };
}

export default {
  async fetch(request, env, ctx) {
    // 环境自检
    if (!env.TOPIC_MAP) return new Response("Error: KV 'TOPIC_MAP' not bound.");
    if (!env.BOT_TOKEN) return new Response("Error: BOT_TOKEN not set.");
    if (!env.SUPERGROUP_ID) return new Response("Error: SUPERGROUP_ID not set.");

    // 【修复 #7】规范化环境变量，统一为字符串类型
    const normalizedEnv = {
        ...env,
        SUPERGROUP_ID: String(env.SUPERGROUP_ID),
        BOT_TOKEN: String(env.BOT_TOKEN)
    };

    // 验证 SUPERGROUP_ID 格式
    if (!normalizedEnv.SUPERGROUP_ID.startsWith("-100")) {
        return new Response("Error: SUPERGROUP_ID must start with -100");
    }

    if (request.method !== "POST") return new Response("OK");

    // 验证 Content-Type
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        Logger.warn('invalid_content_type', { contentType });
        return new Response("OK");
    }

    let update;
    try {
      update = await request.json();

      // 验证基本结构
      if (!update || typeof update !== 'object') {
          Logger.warn('invalid_json_structure', { update: typeof update });
          return new Response("OK");
      }
    } catch (e) {
      Logger.error('json_parse_failed', e);
      return new Response("OK");
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, normalizedEnv, ctx);
      return new Response("OK");
    }

    const msg = update.message;
    if (!msg) return new Response("OK");

    ctx.waitUntil(flushExpiredMediaGroups(normalizedEnv, Date.now()));

    if (msg.chat && msg.chat.type === "private") {
      try {
        await handlePrivateMessage(msg, normalizedEnv, ctx);
      } catch (e) {
        // 不向用户泄露技术细节
        const errText = `⚠️ 系统繁忙，请稍后再试。`;
        await tgCall(normalizedEnv, "sendMessage", { chat_id: msg.chat.id, text: errText });
        Logger.error('private_message_failed', e, { userId: msg.chat.id });
      }
      return new Response("OK");
    }

    // 【修复 #7】使用字符串比较
    if (msg.chat && String(msg.chat.id) === normalizedEnv.SUPERGROUP_ID) {
        if (msg.forum_topic_closed && msg.message_thread_id) {
            await updateThreadStatus(msg.message_thread_id, true, normalizedEnv);
            return new Response("OK");
        }
        if (msg.forum_topic_reopened && msg.message_thread_id) {
            await updateThreadStatus(msg.message_thread_id, false, normalizedEnv);
            return new Response("OK");
        }
        // 【修复】支持 General 话题和普通话题
        // General 话题的 message_thread_id 可能不存在，或者等于 1
        const text = (msg.text || "").trim();
        const isCommand = !!text && text.startsWith("/");
        if (msg.message_thread_id || isCommand) {
            await handleAdminReply(msg, normalizedEnv, ctx);
            return new Response("OK");
        }
    }

    return new Response("OK");
  },
};

// ---------------- 核心业务逻辑 ----------------

async function handlePrivateMessage(msg, env, ctx) {
  const userId = msg.chat.id;
  const key = `user:${userId}`;

  // 速率限制检查
  const rateLimit = await checkRateLimit(userId, env, 'message', CONFIG.RATE_LIMIT_MESSAGE, CONFIG.RATE_LIMIT_WINDOW);
  if (!rateLimit.allowed) {
      await tgCall(env, "sendMessage", {
          chat_id: userId,
          text: "⚠️ 发送过于频繁，请稍后再试。"
      });
      return;
  }

  // 拦截普通用户发送的指令
  if (msg.text && msg.text.startsWith("/") && msg.text.trim() !== "/start") {
      return;
  }

  const isBanned = await env.TOPIC_MAP.get(`banned:${userId}`);
  if (isBanned) return;

  const verified = await env.TOPIC_MAP.get(`verified:${userId}`);

  if (!verified) {
    const isStart = msg.text && msg.text.trim() === "/start";
    const pendingMsgId = (CONFIG.FORWARD_PENDING_AFTER_VERIFY && !isStart) ? msg.message_id : null;
    await sendVerificationChallenge(userId, env, pendingMsgId);
    return;
  }

  const rec = await safeGetJSON(env, key, null);
  if (rec && rec.closed) {
      await tgCall(env, "sendMessage", { chat_id: userId, text: "🚫 当前对话已被管理员关闭。" });
      return;
  }

  const moderation = await moderatePrivateMessage(msg, userId, key, verified, env);
  if (moderation.action === "first_reject") {
      if (moderation.banned) return;
      await notifyUserFirstMessagesRestriction(env, userId, moderation.remaining);
      return;
  }
  if (moderation.action === "block") {
      return;
  }
  if (moderation.action === "review") {
      await quarantineSuspiciousMessage(msg, userId, key, env, moderation.risk, "review");
      await notifyUserReviewOnce(env, userId);
      return;
  }

  await forwardToTopic(msg, userId, key, env, ctx);
  await incrementAllowedMessageCount(env, userId, verified);
}

async function forwardToTopic(msg, userId, key, env, ctx) {
    // 并发兜底：如果已被标记为需要重新验证，直接发起验证并暂停转发/建话题
    const needsVerify = await env.TOPIC_MAP.get(`needs_verify:${userId}`);
    if (needsVerify) {
        const pendingMsgId = CONFIG.FORWARD_PENDING_AFTER_VERIFY ? (msg.message_id || null) : null;
        await sendVerificationChallenge(userId, env, pendingMsgId);
        return;
    }

    // 【修复 #4】使用安全的 JSON 解析
    let rec = await safeGetJSON(env, key, null);

    if (rec && rec.closed) {
        await tgCall(env, "sendMessage", { chat_id: userId, text: "🚫 当前对话已被管理员关闭。" });
        return;
    }

    // 【修复 #5】重试计数器，防止无限循环
    const retryKey = `retry:${userId}`;
    let retryCount = parseInt(await env.TOPIC_MAP.get(retryKey) || "0");

    if (retryCount > CONFIG.MAX_RETRY_ATTEMPTS) {
        await tgCall(env, "sendMessage", {
            chat_id: userId,
            text: "❌ 系统繁忙，请稍后再试。"
        });
        await env.TOPIC_MAP.delete(retryKey);
        return;
    }

    if (!rec || !rec.thread_id) {
        rec = await getOrCreateUserTopicRec(msg.from, key, env, userId);
        if (!rec || !rec.thread_id) {
            throw new Error("创建话题失败");
        }
    }

    // 补建 thread->user 映射（兼容旧数据）
    if (rec && rec.thread_id) {
        const mappedUser = await env.TOPIC_MAP.get(`thread:${rec.thread_id}`);
        if (!mappedUser) {
            await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
        }
    }

    // 【修复1】验证话题是否仍然存在（带缓存，降低探测频率）
    // 当话题被删除后，KV中的thread_id仍然存在，但实际话题已不可用
    if (rec && rec.thread_id) {
        const cacheKey = rec.thread_id;
        const now = Date.now();
        const cached = threadHealthCache.get(cacheKey);
        const withinTTL = cached && (now - cached.ts < CONFIG.THREAD_HEALTH_TTL_MS);

        if (!withinTTL) {
            // 跨节点缓存：避免由于 Workers 多 PoP 导致每次都做健康探测
            const kvHealthKey = `thread_ok:${rec.thread_id}`;
            const kvHealthOk = await env.TOPIC_MAP.get(kvHealthKey);
            if (kvHealthOk === "1") {
                threadHealthCache.set(cacheKey, { ts: now, ok: true });
            } else {
            const probe = await probeForumThread(env, rec.thread_id, { userId, reason: "health_check" });

            if (probe.status === "redirected" || probe.status === "missing" || probe.status === "missing_thread_id") {
                    await resetUserVerificationAndRequireReverify(env, {
                        userId,
                        userKey: key,
                        oldThreadId: rec.thread_id,
                        pendingMsgId: msg.message_id,
                        reason: `health_check:${probe.status}`
                    });
                    return;
            } else if (probe.status === "probe_invalid") {
                Logger.warn('topic_health_probe_invalid_message', {
                    userId,
                    threadId: rec.thread_id,
                    errorDescription: probe.description
                });

                // 仍然设置短 TTL，避免每条消息都探测（并误触发重建）
                threadHealthCache.set(cacheKey, { ts: now, ok: true });
                await env.TOPIC_MAP.put(kvHealthKey, "1", { expirationTtl: Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1000) });
            } else if (probe.status === "unknown_error") {
                Logger.warn('topic_test_failed_unknown', {
                    userId,
                    threadId: rec.thread_id,
                    errorDescription: probe.description
                });
            } else {
                await env.TOPIC_MAP.delete(retryKey);
                threadHealthCache.set(cacheKey, { ts: now, ok: true });
                await env.TOPIC_MAP.put(kvHealthKey, "1", { expirationTtl: Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1000) });
            }
            }
        }
    }

    if (msg.media_group_id) {
        await handleMediaGroup(msg, env, ctx, {
            direction: "p2t",
            targetChat: env.SUPERGROUP_ID,
            threadId: rec.thread_id
        });
        return;
    }

    const res = await tgCall(env, "forwardMessage", {
        chat_id: env.SUPERGROUP_ID,
        from_chat_id: userId,
        message_id: msg.message_id,
        message_thread_id: rec.thread_id,
    });

    // 检测 Telegram 静默重定向到 General 的情况
    const resThreadId = res.result?.message_thread_id;
    if (res.ok && resThreadId !== undefined && resThreadId !== null && Number(resThreadId) !== Number(rec.thread_id)) {
        Logger.warn('forward_redirected_to_general', {
            userId,
            expectedThreadId: rec.thread_id,
            actualThreadId: resThreadId
        });

        // 删除误投到 General 的消息
        if (res.result?.message_id) {
            try {
                await tgCall(env, "deleteMessage", {
                    chat_id: env.SUPERGROUP_ID,
                    message_id: res.result.message_id
                });
            } catch (e) {
                // 删除失败不影响重发
            }
        }
        await resetUserVerificationAndRequireReverify(env, {
            userId,
            userKey: key,
            oldThreadId: rec.thread_id,
            pendingMsgId: msg.message_id,
            reason: "forward_redirected_to_general"
        });
        return;
    }

    // 兜底：部分情况下 Telegram 返回 ok 但不带 message_thread_id（可能已落入 General）
    if (res.ok && (resThreadId === undefined || resThreadId === null)) {
        const probe = await probeForumThread(env, rec.thread_id, { userId, reason: "forward_result_missing_thread_id" });
        if (probe.status !== "ok") {
            Logger.warn('forward_suspected_redirect_or_missing', {
                userId,
                expectedThreadId: rec.thread_id,
                probeStatus: probe.status,
                probeDescription: probe.description
            });

            // 尽量删除误投消息（通常在 General）
            if (res.result?.message_id) {
                try {
                    await tgCall(env, "deleteMessage", {
                        chat_id: env.SUPERGROUP_ID,
                        message_id: res.result.message_id
                    });
                } catch (e) {
                    // 删除失败不影响重发
                }
            }
            await resetUserVerificationAndRequireReverify(env, {
                userId,
                userKey: key,
                oldThreadId: rec.thread_id,
                pendingMsgId: msg.message_id,
                reason: `forward_missing_thread_id:${probe.status}`
            });
            return;
        }
    }

    // 【修复2】增强错误处理，双重保险
    // 如果上面的测试没有捕获到，这里再次检测
    if (!res.ok) {
        const desc = normalizeTgDescription(res.description);
        if (isTopicMissingOrDeleted(desc)) {
            Logger.warn('forward_failed_topic_missing', {
                userId,
                threadId: rec.thread_id,
                errorDescription: res.description
            });
            await resetUserVerificationAndRequireReverify(env, {
                userId,
                userKey: key,
                oldThreadId: rec.thread_id,
                pendingMsgId: msg.message_id,
                reason: "forward_failed_topic_missing"
            });
            return;
        }

        if (desc.includes("chat not found")) throw new Error(`群组ID错误: ${env.SUPERGROUP_ID}`);
        if (desc.includes("not enough rights")) throw new Error("机器人权限不足 (需 Manage Topics)");

        // 如果forwardMessage失败，尝试使用copyMessage作为降级方案
        await tgCall(env, "copyMessage", {
            chat_id: env.SUPERGROUP_ID,
            from_chat_id: userId,
            message_id: msg.message_id,
            message_thread_id: rec.thread_id
        });
    }
}

async function handleAdminReply(msg, env, ctx) {
  const threadId = msg.message_thread_id;
  const text = (msg.text || "").trim();
  const senderId = msg.from?.id;

  // 仅允许管理员在群内操作与回信，防止任意群成员向用户私聊注入消息
  if (!senderId || !(await isAdminUser(env, senderId))) {
      return;
  }

  // 【修复】允许在任何话题执行 /cleanup 命令
  if (text === "/cleanup") {
      // /cleanup 可能处理较久，使用 waitUntil 防止 webhook 请求超时导致“卡住”
      ctx.waitUntil(handleCleanupCommand(threadId, env));
      return;
  }

  // 优先通过 thread 映射快速反查用户，缺失时再降级全量扫描
  let userId = null;
  const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
  if (mappedUser) {
      userId = Number(mappedUser);
  } else {
      const allKeys = await getAllKeys(env, "user:");
      for (const { name } of allKeys) {
          const rec = await safeGetJSON(env, name, null);
          if (rec && Number(rec.thread_id) === Number(threadId)) {
              userId = Number(name.slice(5));
              break;
          }
      }
  }

  // 如果找不到用户，说明可能是在普通话题，或者数据丢失，直接返回
  if (!userId) return; 

  // --- 指令区域 ---

  if (text === "/close") {
      const key = `user:${userId}`;
      let rec = await safeGetJSON(env, key, null);
      if (rec) {
          rec.closed = true;
          await env.TOPIC_MAP.put(key, JSON.stringify(rec));
          await tgCall(env, "closeForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
          await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🚫 **对话已强制关闭**", parse_mode: "Markdown" });
      }
      return;
  }

  if (text === "/open") {
      const key = `user:${userId}`;
      let rec = await safeGetJSON(env, key, null);
      if (rec) {
          rec.closed = false;
          await env.TOPIC_MAP.put(key, JSON.stringify(rec));
          await tgCall(env, "reopenForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
          await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "✅ **对话已恢复**", parse_mode: "Markdown" });
      }
      return;
  }

  if (text === "/reset") {
      await env.TOPIC_MAP.delete(`verified:${userId}`);
      await env.TOPIC_MAP.delete(`observation:${userId}`);
      await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
      await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🔄 **验证重置**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/trust") {
      await env.TOPIC_MAP.put(`verified:${userId}`, "trusted");
      await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
      await env.TOPIC_MAP.delete(`observation:${userId}`);
      await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
      await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🌟 **已设置永久信任**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/ban") {
      await env.TOPIC_MAP.put(`banned:${userId}`, "1");
      await env.TOPIC_MAP.delete(`verified:${userId}`);
      await env.TOPIC_MAP.delete(`observation:${userId}`);
      await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
      await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🚫 **用户已封禁**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/unban") {
      await env.TOPIC_MAP.delete(`banned:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "✅ **用户已解封**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/info") {
      const userKey = `user:${userId}`;
      const userRec = await safeGetJSON(env, userKey, null);
      const verifyStatus = await env.TOPIC_MAP.get(`verified:${userId}`);
      const banStatus = await env.TOPIC_MAP.get(`banned:${userId}`);

      const info = `👤 **用户信息**\nUID: \`${userId}\`\nTopic ID: \`${threadId}\`\n话题标题: ${userRec?.title || "未知"}\n验证状态: ${verifyStatus ? (verifyStatus === 'trusted' ? '🌟 永久信任' : '✅ 已验证') : '❌ 未验证'}\n封禁状态: ${banStatus ? '🚫 已封禁' : '✅ 正常'}\nLink: [点击私聊](tg://user?id=${userId})`;
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: info, parse_mode: "Markdown" });
      return;
  }

  // 转发管理员消息给用户
  if (msg.media_group_id) {
    await handleMediaGroup(msg, env, ctx, { direction: "t2p", targetChat: userId, threadId: undefined });
    return;
  }
  await tgCall(env, "copyMessage", { chat_id: userId, from_chat_id: env.SUPERGROUP_ID, message_id: msg.message_id });
}

// ---------------- 验证模块 (纯本地) ----------------

async function sendVerificationChallenge(userId, env, pendingMsgId) {
    const cooldown = await env.TOPIC_MAP.get(`verify_cooldown:${userId}`);
    if (cooldown) {
        await tgCall(env, "sendMessage", {
            chat_id: userId,
            text: "⚠️ 验证失败次数过多，请5分钟后再试。"
        });
        return;
    }

    // 【修复 #1】检查是否已有进行中的验证
    const existingChallenge = await env.TOPIC_MAP.get(`user_challenge:${userId}`);
    if (existingChallenge) {
        // 有正在进行的验证：仅将新消息加入待发送队列，避免重复下发题目/触发验证限速
        const chalKey = `chal:${existingChallenge}`;
        const state = await safeGetJSON(env, chalKey, null);

        // KV 可能存在不一致/过期：自愈清理后重新下发
        if (!state || state.userId !== userId) {
            await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
        } else {
            if (CONFIG.FORWARD_PENDING_AFTER_VERIFY && pendingMsgId) {
                let pendingIds = [];
                if (Array.isArray(state.pending_ids)) {
                    pendingIds = state.pending_ids.slice();
                } else if (state.pending) {
                    pendingIds = [state.pending];
                }

                if (!pendingIds.includes(pendingMsgId)) {
                    pendingIds.push(pendingMsgId);
                    if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) {
                        pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
                    }
                    state.pending_ids = pendingIds;
                    delete state.pending;
                    await env.TOPIC_MAP.put(chalKey, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
                }
            }
            Logger.debug('verification_duplicate_skipped', { userId, verifyId: existingChallenge, hasPending: !!pendingMsgId });
            return;
        }
    }

    // 验证请求速率限制：仅在需要创建新挑战时检查
    const verifyLimit = await checkRateLimit(userId, env, 'verify', CONFIG.RATE_LIMIT_VERIFY, 300);
    if (!verifyLimit.allowed) {
        await tgCall(env, "sendMessage", {
            chat_id: userId,
            text: "⚠️ 验证请求过于频繁，请5分钟后再试。"
        });
        return;
    }

    // 【修复 #9】使用加密安全的随机数
    const q = LOCAL_QUESTIONS[secureRandomInt(0, LOCAL_QUESTIONS.length)];
    const challenge = {
        question: q.question,
        correct: q.correct_answer,
        options: shuffleArray([...q.incorrect_answers, q.correct_answer])
    };

    // 【修复 #9】使用加密安全的ID生成
    const verifyId = secureRandomId(CONFIG.VERIFY_ID_LENGTH);

    // 【修复 #6】使用答案索引而非文本，避免截断问题
    const answerIndex = challenge.options.indexOf(challenge.correct);

    const state = {
        answerIndex: answerIndex,      // 存储索引
        options: challenge.options,     // 存储完整选项列表
        attempts: 0,
        pending_ids: (CONFIG.FORWARD_PENDING_AFTER_VERIFY && pendingMsgId) ? [pendingMsgId] : [],
        userId: userId                  // 添加用户ID验证
    };

    await env.TOPIC_MAP.put(`chal:${verifyId}`, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });

    // 【修复 #1】标记用户正在验证中
    await env.TOPIC_MAP.put(`user_challenge:${userId}`, verifyId, { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });

    Logger.info('verification_sent', {
        userId,
        verifyId,
        question: q.question,
        pendingCount: state.pending_ids.length
    });

    // 【修复 #6】按钮使用索引而非文本
    const buttons = challenge.options.map((opt, idx) => ({
        text: opt,
        callback_data: `verify:${verifyId}:${idx}`  // 使用索引
    }));

    const keyboard = [];
    for (let i = 0; i < buttons.length; i += CONFIG.BUTTON_COLUMNS) {
        keyboard.push(buttons.slice(i, i + CONFIG.BUTTON_COLUMNS));
    }

    await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: `🛡️ **人机验证**\n\n${challenge.question}\n\n请点击下方按钮回答。验证通过后，请重新发送需要送达的内容。`,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleCallbackQuery(query, env, ctx) {
    try {
        const data = query.data;
        if (!data.startsWith("verify:")) return;

        const parts = data.split(":");
        if (parts.length !== 3) return;

        const verifyId = parts[1];
        const selectedIndex = parseInt(parts[2]);  // 【修复 #6】用户选择的索引
        const userId = query.from.id;

        const stateStr = await env.TOPIC_MAP.get(`chal:${verifyId}`);
        if (!stateStr) {
            await tgCall(env, "answerCallbackQuery", {
                callback_query_id: query.id,
                text: "❌ 验证已过期，请重发消息",
                show_alert: true
            });
            return;
        }

        let state;
        try {
            state = JSON.parse(stateStr);
        } catch(e) {
             await tgCall(env, "answerCallbackQuery", {
                 callback_query_id: query.id,
                 text: "❌ 数据错误",
                 show_alert: true
             });
             return;
        }

        // 【修复 #1】验证用户ID匹配
        if (state.userId && state.userId !== userId) {
            await tgCall(env, "answerCallbackQuery", {
                callback_query_id: query.id,
                text: "❌ 无效的验证",
                show_alert: true
            });
            return;
        }

        // 【修复 #6】验证索引有效性
        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.options.length) {
            await tgCall(env, "answerCallbackQuery", {
                callback_query_id: query.id,
                text: "❌ 无效选项",
                show_alert: true
            });
            return;
        }

        if (selectedIndex === state.answerIndex) {
            await tgCall(env, "answerCallbackQuery", {
                callback_query_id: query.id,
                text: "✅ 验证通过"
            });

            Logger.info('verification_passed', {
                userId,
                verifyId,
                selectedOption: state.options[selectedIndex]
            });

            // 普通验证有效期较短；管理员 /trust 才是永久信任
            await env.TOPIC_MAP.put(`verified:${userId}`, "1", { expirationTtl: CONFIG.VERIFIED_EXPIRE_SECONDS });
            await env.TOPIC_MAP.put(`observation:${userId}`, "1", { expirationTtl: CONFIG.UNTRUSTED_OBSERVATION_SECONDS });
            await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
            await env.TOPIC_MAP.delete(`verify_cooldown:${userId}`);
            await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
            await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);

            // 【修复 #1】清理所有相关挑战
            await env.TOPIC_MAP.delete(`chal:${verifyId}`);
            await env.TOPIC_MAP.delete(`user_challenge:${userId}`);

            await tgCall(env, "editMessageText", {
                chat_id: userId,
                message_id: query.message.message_id,
                text: "✅ **验证成功**\n\n请重新发送需要送达的内容。新用户请先用文字说明来意，暂不要先发链接、二维码、联系方式或文件。",
                parse_mode: "Markdown"
            });

            const hasPending = (Array.isArray(state.pending_ids) && state.pending_ids.length > 0) || !!state.pending;
            if (CONFIG.FORWARD_PENDING_AFTER_VERIFY && hasPending) {
                try {
                    let pendingIds = [];
                    if (Array.isArray(state.pending_ids)) {
                        pendingIds = state.pending_ids.slice();
                    } else if (state.pending) {
                        pendingIds = [state.pending];
                    }

                    // 限制一次性转发量，避免用户恶意堆积导致执行超时
                    if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) {
                        pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
                    }

                    let forwardedCount = 0;
                    for (const pendingId of pendingIds) {
                        if (!pendingId) continue;
                        const forwardedKey = `forwarded:${userId}:${pendingId}`;
                        const alreadyForwarded = await env.TOPIC_MAP.get(forwardedKey);
                        if (alreadyForwarded) {
                            Logger.info('message_forward_duplicate_skipped', { userId, messageId: pendingId });
                            continue;
                        }

                        const fakeMsg = {
                            message_id: pendingId,
                            chat: { id: userId, type: "private" },
                            from: query.from,
                        };

                        await forwardToTopic(fakeMsg, userId, `user:${userId}`, env, ctx);
                        await env.TOPIC_MAP.put(forwardedKey, "1", { expirationTtl: 3600 });
                        forwardedCount++;
                    }

                    if (forwardedCount > 0) {
                        await tgCall(env, "sendMessage", {
                            chat_id: userId,
                            text: `📩 刚才的 ${forwardedCount} 条消息已帮您送达。`
                        });
                    }
                } catch (e) {
                    Logger.error('pending_message_forward_failed', e, { userId });
                    await tgCall(env, "sendMessage", {
                        chat_id: userId,
                        text: "⚠️ 自动发送失败，请重新发送您的消息。"
                    });
                }
            } else if (hasPending) {
                await tgCall(env, "sendMessage", {
                    chat_id: userId,
                    text: "为降低广告首条直达风险，验证前发送的消息不会自动送达。请重新发送需要送达的内容。"
                });
            }
        } else {
            state.attempts = parseInt(state.attempts || "0") + 1;
            Logger.info('verification_failed', {
                userId,
                verifyId,
                selectedIndex,
                correctIndex: state.answerIndex,
                attempts: state.attempts
            });

            if (state.attempts >= CONFIG.VERIFY_MAX_ATTEMPTS) {
                await env.TOPIC_MAP.delete(`chal:${verifyId}`);
                await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
                await env.TOPIC_MAP.put(`verify_cooldown:${userId}`, "1", { expirationTtl: CONFIG.VERIFY_FAIL_COOLDOWN_SECONDS });

                await tgCall(env, "answerCallbackQuery", {
                    callback_query_id: query.id,
                    text: "❌ 验证失败次数过多，请5分钟后再试",
                    show_alert: true
                });

                await tgCall(env, "editMessageText", {
                    chat_id: userId,
                    message_id: query.message.message_id,
                    text: "❌ **验证失败次数过多**\n\n请5分钟后重新发送消息再验证。",
                    parse_mode: "Markdown"
                });
                return;
            }

            await env.TOPIC_MAP.put(`chal:${verifyId}`, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });

            await tgCall(env, "answerCallbackQuery", {
                callback_query_id: query.id,
                text: `❌ 答案错误，还可尝试 ${CONFIG.VERIFY_MAX_ATTEMPTS - state.attempts} 次`,
                show_alert: true
            });
        }
    } catch (e) {
        Logger.error('callback_query_error', e, {
            userId: query.from?.id,
            callbackData: query.data
        });
        await tgCall(env, "answerCallbackQuery", {
            callback_query_id: query.id,
            text: `⚠️ 系统错误，请重试`,
            show_alert: true
        });
    }
}

// ---------------- 辅助函数 ----------------

/**
 * 【修复 #8】批量清理命令处理函数（优化并发性能）
 *
 * 功能说明：
 * 1. 检查所有用户的话题记录
 * 2. 找出话题ID已不存在（被删除）的用户
 * 3. 删除这些用户的KV存储记录和验证状态
 * 4. 让他们下次发消息时重新验证并创建新话题
 *
 * 使用场景：
 * - 管理员手动删除了多个用户话题后
 * - 需要批量重置这些用户的状态
 *
 * @param {number} threadId - 当前话题ID（通常在General话题中调用）
 * @param {object} env - 环境变量对象
 */
async function handleCleanupCommand(threadId, env) {
    const lockKey = "cleanup:lock";
    const locked = await env.TOPIC_MAP.get(lockKey);
    if (locked) {
        await tgCall(env, "sendMessage", withMessageThreadId({
            chat_id: env.SUPERGROUP_ID,
            text: "⏳ **已有清理任务正在运行，请稍后再试。**",
            parse_mode: "Markdown"
        }, threadId));
        return;
    }

    await env.TOPIC_MAP.put(lockKey, "1", { expirationTtl: CONFIG.CLEANUP_LOCK_TTL_SECONDS });

    // 发送处理中的消息
    await tgCall(env, "sendMessage", withMessageThreadId({
        chat_id: env.SUPERGROUP_ID,
        text: "🔄 **正在扫描需要清理的用户...**",
        parse_mode: "Markdown"
    }, threadId));

    let cleanedCount = 0;
    let errorCount = 0;
    const cleanedUsers = [];
    let scannedCount = 0;

    try {
        // 逐页扫描，避免一次性拉取全部 keys 导致超时/内存膨胀
        let cursor = undefined;
        do {
            const result = await env.TOPIC_MAP.list({ prefix: "user:", cursor });
            const names = (result.keys || []).map(k => k.name);
            scannedCount += names.length;

            // 批量并发处理（限制并发数）
            for (let i = 0; i < names.length; i += CONFIG.CLEANUP_BATCH_SIZE) {
                const batch = names.slice(i, i + CONFIG.CLEANUP_BATCH_SIZE);

                const results = await Promise.allSettled(
                    batch.map(async (name) => {
                        const rec = await safeGetJSON(env, name, null);
                    if (!rec || !rec.thread_id) return null;

                    const userId = name.slice(5);
                    const topicThreadId = rec.thread_id;

                    // 检测话题是否存在：尝试向话题发送测试消息
                    const probe = await probeForumThread(env, topicThreadId, {
                        userId,
                        reason: "cleanup_check",
                        doubleCheckOnMissingThreadId: false
                    });

                    // cleanup 要求更保守：仅在明确缺失/重定向时清理，避免误删有效记录
                    if (probe.status === "redirected" || probe.status === "missing") {
                            await env.TOPIC_MAP.delete(name);
                            await env.TOPIC_MAP.delete(`verified:${userId}`);
                            await env.TOPIC_MAP.delete(`observation:${userId}`);
                            await env.TOPIC_MAP.delete(`allowed_msg_count:${userId}`);
                            await env.TOPIC_MAP.delete(`first_reject_hits:${userId}`);
                            await env.TOPIC_MAP.delete(`thread:${topicThreadId}`);

                            return {
                                userId,
                                threadId: topicThreadId,
                                title: rec.title || "未知"
                            };
                    } else if (probe.status === "probe_invalid") {
                        Logger.warn('cleanup_probe_invalid_message', {
                            userId,
                            threadId: topicThreadId,
                            errorDescription: probe.description
                        });
                    } else if (probe.status === "unknown_error") {
                        Logger.warn('cleanup_probe_failed_unknown', {
                            userId,
                            threadId: topicThreadId,
                            errorDescription: probe.description
                        });
                    } else if (probe.status === "missing_thread_id") {
                        Logger.warn('cleanup_probe_missing_thread_id', { userId, threadId: topicThreadId });
                    }

                    return null;
                })
            );

            // 处理结果
            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    cleanedCount++;
                    cleanedUsers.push(result.value);
                    Logger.info('cleanup_user', {
                        userId: result.value.userId,
                        threadId: result.value.threadId
                    });
                } else if (result.status === 'rejected') {
                    errorCount++;
                    Logger.error('cleanup_batch_error', result.reason);
                }
            });

                // 防止速率限制
                if (i + CONFIG.CLEANUP_BATCH_SIZE < names.length) {
                    await new Promise(r => setTimeout(r, 600));
                }
            }

            cursor = result.list_complete ? undefined : result.cursor;

            // 在分页之间让出时间片，降低单次执行压力
            if (cursor) {
                await new Promise(r => setTimeout(r, 200));
            }
        } while (cursor);

        // 生成并发送清理报告
        let reportText = `✅ **清理完成**\n\n`;
        reportText += `📊 **统计信息**\n`;
        reportText += `- 扫描用户数: ${scannedCount}\n`;
        reportText += `- 已清理用户数: ${cleanedCount}\n`;
        reportText += `- 错误数: ${errorCount}\n\n`;

        if (cleanedCount > 0) {
            reportText += `🗑️ **已清理的用户** (话题已删除):\n`;
            for (const user of cleanedUsers.slice(0, CONFIG.MAX_CLEANUP_DISPLAY)) {
                reportText += `- UID: \`${user.userId}\` | 话题: ${user.title}\n`;
            }
            if (cleanedUsers.length > CONFIG.MAX_CLEANUP_DISPLAY) {
                reportText += `\n...(还有 ${cleanedUsers.length - CONFIG.MAX_CLEANUP_DISPLAY} 个用户)\n`;
            }
            reportText += `\n💡 这些用户下次发消息时将重新进行人机验证并创建新话题。`;
        } else {
            reportText += `✨ 没有发现需要清理的用户记录。`;
        }

        Logger.info('cleanup_completed', {
            cleanedCount,
            errorCount,
            totalUsers: scannedCount
        });

        await tgCall(env, "sendMessage", withMessageThreadId({
            chat_id: env.SUPERGROUP_ID,
            text: reportText,
            parse_mode: "Markdown"
        }, threadId));

    } catch (e) {
        Logger.error('cleanup_failed', e, { threadId });
        await tgCall(env, "sendMessage", withMessageThreadId({
            chat_id: env.SUPERGROUP_ID,
            text: `❌ **清理过程出错**\n\n错误信息: \`${e.message}\``,
            parse_mode: "Markdown"
        }, threadId));
    } finally {
        await env.TOPIC_MAP.delete(lockKey);
    }
}

// ---------------- 其他辅助函数 ----------------

// 为话题建立 thread->user 映射，避免管理员命令时全量 KV 反查
async function createTopic(from, key, env, userId) {
    const title = buildTopicTitle(from);
    if (!env.SUPERGROUP_ID.toString().startsWith("-100")) throw new Error("SUPERGROUP_ID必须以-100开头");
    const res = await tgCall(env, "createForumTopic", { chat_id: env.SUPERGROUP_ID, name: title });
    if (!res.ok) throw new Error(`创建话题失败: ${res.description}`);
    const rec = { thread_id: res.result.message_thread_id, title, closed: false };
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    if (userId) {
        await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
    }
    return rec;
}

// 【修复 #2】更新话题状态 - 修复异步操作未等待
async function updateThreadStatus(threadId, isClosed, env) {
    try {
        const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
        if (mappedUser) {
            const userKey = `user:${mappedUser}`;
            const rec = await safeGetJSON(env, userKey, null);
            if (rec && Number(rec.thread_id) === Number(threadId)) {
                rec.closed = isClosed;
                await env.TOPIC_MAP.put(userKey, JSON.stringify(rec));
                Logger.info('thread_status_updated', { threadId, isClosed, updatedCount: 1 });
                return;
            }

            // 映射失效：清理后降级全量扫描
            await env.TOPIC_MAP.delete(`thread:${threadId}`);
        }

        const allKeys = await getAllKeys(env, "user:");
        const updates = [];

        for (const { name } of allKeys) {
            const rec = await safeGetJSON(env, name, null);
            if (rec && Number(rec.thread_id) === Number(threadId)) {
                rec.closed = isClosed;
                updates.push(env.TOPIC_MAP.put(name, JSON.stringify(rec)));
            }
        }

        await Promise.all(updates);
        Logger.info('thread_status_updated', { threadId, isClosed, updatedCount: updates.length });
    } catch (e) {
        Logger.error('thread_status_update_failed', e, { threadId, isClosed });
        throw e;
    }
}

// 改进的话题标题构建（清理特殊字符）
function buildTopicTitle(from) {
  const firstName = (from.first_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);
  const lastName = (from.last_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);

  // 清理 username
  let username = "";
  if (from.username) {
      username = from.username
          .replace(/[^\w]/g, '')  // 只保留字母数字下划线
          .substring(0, 20);
  }

  // 移除控制字符和换行符
  const cleanName = (firstName + " " + lastName)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const name = cleanName || "User";
  const usernameStr = username ? ` @${username}` : "";

  // Telegram 话题标题最大长度为 128 字符
  const title = (name + usernameStr).substring(0, CONFIG.MAX_TITLE_LENGTH);

  return title;
}

// 改进的 Telegram API 调用（添加超时和 HTTPS 强制）
async function tgCall(env, method, body, timeout = CONFIG.API_TIMEOUT_MS) {
  let base = env.API_BASE || "https://api.telegram.org";

  // 【修复 #20】强制 HTTPS
  if (base.startsWith("http://")) {
      Logger.warn('api_http_upgraded', { originalBase: base });
      base = base.replace("http://", "https://");
  }

  // 验证 URL 格式
  try {
      new URL(`${base}/test`);
  } catch (e) {
      Logger.error('api_base_invalid', e, { base });
      base = "https://api.telegram.org";
  }

  // 【修复 #13】添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
      const resp = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!resp.ok && resp.status >= 500) {
          Logger.warn('telegram_api_server_error', {
              method,
              status: resp.status
          });
      }

      const result = await resp.json();

      // 记录速率限制
      if (!result.ok && result.description && result.description.includes('Too Many Requests')) {
          const retryAfter = result.parameters?.retry_after || 5;
          Logger.warn('telegram_api_rate_limit', {
              method,
              retryAfter
          });
      }

      return result;
  } catch (e) {
      clearTimeout(timeoutId);

      if (e.name === 'AbortError') {
          Logger.error('telegram_api_timeout', e, { method, timeout });
          return { ok: false, description: 'Request timeout' };
      }

      Logger.error('telegram_api_failed', e, { method });
      throw e;
  }
}

async function handleMediaGroup(msg, env, ctx, { direction, targetChat, threadId }) {
    const groupId = msg.media_group_id;
    const key = `mg:${direction}:${groupId}`;
    const item = extractMedia(msg);
    if (!item) {
        await tgCall(env, "copyMessage", withMessageThreadId({
            chat_id: targetChat,
            from_chat_id: msg.chat.id,
            message_id: msg.message_id
        }, threadId));
        return;
    }
    let rec = await safeGetJSON(env, key, null);
    if (!rec) rec = { direction, targetChat, threadId: (threadId === null ? undefined : threadId), items: [], last_ts: Date.now() };
    rec.items.push({ ...item, msg_id: msg.message_id });
    rec.last_ts = Date.now();
    await env.TOPIC_MAP.put(key, JSON.stringify(rec), { expirationTtl: CONFIG.MEDIA_GROUP_EXPIRE_SECONDS });
    ctx.waitUntil(delaySend(env, key, rec.last_ts));
}

// 【修复 #15, #19】改进的媒体提取（支持更多类型，不修改原数组）
function extractMedia(msg) {
    // 图片
    if (msg.photo && msg.photo.length > 0) {
        const highestResolution = msg.photo[msg.photo.length - 1];  // 不使用 pop()
        return {
            type: "photo",
            id: highestResolution.file_id,
            cap: msg.caption || ""
        };
    }

    // 视频
    if (msg.video) {
        return {
            type: "video",
            id: msg.video.file_id,
            cap: msg.caption || ""
        };
    }

    // 文档
    if (msg.document) {
        return {
            type: "document",
            id: msg.document.file_id,
            cap: msg.caption || ""
        };
    }

    // 音频
    if (msg.audio) {
        return {
            type: "audio",
            id: msg.audio.file_id,
            cap: msg.caption || ""
        };
    }

    // 动图
    if (msg.animation) {
        return {
            type: "animation",
            id: msg.animation.file_id,
            cap: msg.caption || ""
        };
    }

    // 语音和视频消息不支持 media group
    return null;
}

// 【修复 #21】实现媒体组清理
async function flushExpiredMediaGroups(env, now) {
    try {
        const prefix = "mg:";
        const allKeys = await getAllKeys(env, prefix);
        let deletedCount = 0;

        for (const { name } of allKeys) {
            const rec = await safeGetJSON(env, name, null);
            if (rec && rec.last_ts && (now - rec.last_ts > 300000)) { // 超过 5 分钟
                await env.TOPIC_MAP.delete(name);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            Logger.info('media_groups_cleaned', { deletedCount });
        }
    } catch (e) {
        Logger.error('media_group_cleanup_failed', e);
    }
}

// 【修复 #12, #28】改进媒体组延迟发送
async function delaySend(env, key, ts) {
    await new Promise(r => setTimeout(r, CONFIG.MEDIA_GROUP_DELAY_MS));

    const rec = await safeGetJSON(env, key, null);

    if (rec && rec.last_ts === ts) {
        // 验证媒体数组
        if (!rec.items || rec.items.length === 0) {
            Logger.warn('media_group_empty', { key });
            await env.TOPIC_MAP.delete(key);
            return;
        }

        const media = rec.items.map((it, i) => {
            if (!it.type || !it.id) {
                Logger.warn('media_group_invalid_item', { key, item: it });
                return null;
            }
            // 【修复 #28】限制 caption 长度
            const caption = i === 0 ? (it.cap || "").substring(0, 1024) : "";
            return { 
                type: it.type,
                media: it.id,
                caption
            };
        }).filter(Boolean);  // 过滤掉无效项

        if (media.length > 0) {
            try {
                const result = await tgCall(env, "sendMediaGroup", withMessageThreadId({
                    chat_id: rec.targetChat,
                    media
                }, rec.threadId));

                if (!result.ok) {
                    Logger.error('media_group_send_failed', result.description, {
                        key,
                        mediaCount: media.length
                    });
                } else {
                    Logger.info('media_group_sent', {
                        key,
                        mediaCount: media.length,
                        targetChat: rec.targetChat
                    });
                }
            } catch (e) {
                Logger.error('media_group_send_exception', e, { key });
            }
        }

        await env.TOPIC_MAP.delete(key);
    }
}
