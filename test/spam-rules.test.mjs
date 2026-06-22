import assert from "node:assert/strict";
import { CONFIG, scoreSpamMessage } from "../worker.js";

function makeMessage(text, extra = {}) {
  return {
    message_id: 1,
    chat: { id: 10001, type: "private" },
    from: { id: 10001, first_name: "Test" },
    text,
    ...extra
  };
}

function score(text, opts = {}) {
  return scoreSpamMessage(makeMessage(text), {
    inObservation: true,
    isFirstThread: true,
    ...opts
  });
}

const trxAd = score(
  "全网最低价USDT转账手续费，能量租赁，会员代开，TRX兑换：https://t.me/zulinx5bot\nvpn，能量租赁招收代理：@bmwx5"
);
assert.ok(
  trxAd.score >= CONFIG.SPAM_DIRECT_BAN_SCORE,
  `expected TRX/VPN ad to reach direct-ban score, got ${trxAd.score}`
);

const bulkAd = score(
  "别再人肉死撑着发广告了。\n自动批量群发，让软件帮你去跑量。\n👉 频道：@FzdN1\n👉 群组：@Fzdn6"
);
assert.ok(
  bulkAd.score >= CONFIG.SPAM_BLOCK_SCORE,
  `expected bulk-send ad to be blocked, got ${bulkAd.score}`
);

const obfuscated = score("频道 t . me / test dot vip 联系 v x abc123");
assert.equal(obfuscated.features.hasLink, true);
assert.equal(obfuscated.features.hasContact, true);

const mediaOnly = scoreSpamMessage(
  makeMessage("", { text: undefined, photo: [{ file_id: "photo_1" }] }),
  { inObservation: true, isFirstThread: true }
);
assert.equal(mediaOnly.features.hasMedia, true);

const normal = score("你好，我想咨询一下服务怎么使用", {
  inObservation: false,
  isFirstThread: false
});
assert.ok(
  normal.score < CONFIG.SPAM_REVIEW_SCORE,
  `expected normal message below review score, got ${normal.score}`
);

console.log("spam rule tests passed");
