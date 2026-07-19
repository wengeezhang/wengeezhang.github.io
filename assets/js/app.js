/* ============================================================
   LLM 修炼手册 — app.js
   纯静态 SPA：hash 路由 + marked 渲染 + KaTeX + hljs
   自定义 Markdown 扩展：
     - $...$ / $$...$$  数学公式
     - :::note|tip|warn|danger|correction|deep [标题] ... :::  提示块
     - :::quiz ... :::  互动测验（Q: / - [x] / E: 语法）
   ============================================================ */
(function () {
  'use strict';

  const DATA = window.__CONTENT__;
  if (!DATA || !DATA.manifest) {
    document.getElementById('content').innerHTML =
      '<h1>内容未构建</h1><p>请先运行 <code>python3 build.py</code> 生成 <code>assets/js/content.js</code>。</p>';
    return;
  }
  const MANIFEST = DATA.manifest;
  const CHAPTERS = DATA.chapters || {};   // 免费章节；解锁后合并付费章节

  /* ================= 付费墙 =================
     content.paid.js 提供 window.__PAID__（AES-256-CTR + HMAC-SHA256 密文 + 激活码 wrap 表）。
     任一有效激活码 → 派生 wrapKey → 解出主密钥 K → 解密全部付费章节。
     K 缓存在 localStorage（llmlearn.k），激活码本身不落盘。 */
  const PROMO = !!(MANIFEST.site && MANIFEST.site.promo);   // 推广模式：全站免费、隐藏付费入口
  const PAID = window.__PAID__ || null;
  const FREE = {};
  MANIFEST.parts.forEach(p => (p.chapters || []).forEach(c => { FREE[c.id] = !!c.free; }));
  let UNLOCKED = false;

  const utf8 = s => new TextEncoder().encode(s);
  const hexBytes = h => { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; };
  const bytesHex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  const b64Bytes = b => { const s = atob(b); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  const concatB = (x, y) => { const a = new Uint8Array(x.length + y.length); a.set(x); a.set(y, x.length); return a; };
  const sha256B = inp => new Uint8Array(sha256.array(inp));
  const macKeyOf = key => sha256B(concatB(utf8('llms-mac-v1'), key));
  function decryptBox(key, ivHex, ct, tagHex) {   // 校验 HMAC 再解密；失败返回 null
    const iv = hexBytes(ivHex);
    const tag = new Uint8Array(sha256.hmac.array(macKeyOf(key), concatB(iv, ct))).slice(0, 16);
    if (bytesHex(tag) !== tagHex) return null;
    return new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv)).decrypt(ct);
  }
  function unlockWithKey(K, persist) {
    if (!PAID) return { ok: false, msg: '付费内容包缺失（content.paid.js 未加载）' };
    const plain = decryptBox(K, PAID.content.i, b64Bytes(PAID.content.c), PAID.content.t);
    if (!plain) return { ok: false, msg: '密钥校验失败' };
    const data = JSON.parse(new TextDecoder().decode(plain));
    Object.assign(CHAPTERS, data.chapters);
    UNLOCKED = true;
    if (persist) localStorage.setItem('llmlearn.k', bytesHex(K));
    return { ok: true };
  }
  function tryUnlock(codeRaw) {
    if (!PAID) return { ok: false, msg: '付费内容包缺失' };
    const code = (codeRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 10) return { ok: false, msg: '激活码格式不对，请完整粘贴' };
    const wk = sha256B(utf8('llms-wrap-v1|' + PAID.salt + '|' + code));
    for (const w of PAID.wraps) {
      const K = decryptBox(wk, w.i, hexBytes(w.c), w.t);
      if (K) return unlockWithKey(K, true);
    }
    return { ok: false, msg: '激活码无效，请检查是否复制完整（含 LLMS- 前缀可写可不写）' };
  }
  // 启动时用缓存的 K 自动解锁
  (function () {
    const k = localStorage.getItem('llmlearn.k');
    if (k && PAID) {
      try { if (!unlockWithKey(hexBytes(k), false).ok) localStorage.removeItem('llmlearn.k'); }
      catch (e) { localStorage.removeItem('llmlearn.k'); }
    }
  })();
  const isLocked = id => !CHAPTERS[id];
  /* ============== 付费墙 end ============== */

  /* ---------- 章节线性顺序 ---------- */
  const ORDER = [];               // [{id,title,partId,partTitle,icon,difficulty}]
  const CH_INDEX = {};            // id -> order index
  MANIFEST.parts.forEach(p => {
    (p.chapters || []).forEach(c => {
      CH_INDEX[c.id] = ORDER.length;
      ORDER.push({ id: c.id, title: c.title, partId: p.id, partTitle: p.title, icon: p.icon, difficulty: c.difficulty || 1, sources: c.sources || [] });
    });
  });

  /* ---------- 本地存储 ---------- */
  const store = {
    get done() { try { return JSON.parse(localStorage.getItem('llmlearn.done') || '{}'); } catch (e) { return {}; } },
    set done(v) { localStorage.setItem('llmlearn.done', JSON.stringify(v)); },
    toggleDone(id) { const d = store.done; if (d[id]) delete d[id]; else d[id] = 1; store.done = d; },
    get theme() { return localStorage.getItem('llmlearn.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); },
    set theme(v) { localStorage.setItem('llmlearn.theme', v); }
  };

  /* ---------- 主题 ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.getElementById('hljs-light').disabled = (t === 'dark');
    document.getElementById('hljs-dark').disabled = (t !== 'dark');
    document.getElementById('theme-toggle').textContent = t === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(store.theme);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const t = store.theme === 'dark' ? 'light' : 'dark';
    store.theme = t; applyTheme(t);
  });

  /* ---------- KaTeX 渲染 ---------- */
  function tex(src, display) {
    try {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false });
    } catch (e) {
      return '<code>' + escapeHtml(src) + '</code>';
    }
  }
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- marked 扩展 ---------- */
  const extBlockMath = {
    name: 'blockMath', level: 'block',
    start(src) { const i = src.indexOf('$$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
      if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
    },
    renderer(tok) { return '<div class="math-block">' + tex(tok.text, true) + '</div>\n'; }
  };
  const extInlineMath = {
    name: 'inlineMath', level: 'inline',
    start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      if (src.startsWith('$$')) return;                       // 交给 blockMath
      const m = /^\$((?:\\\$|[^$\n])+?)\$/.exec(src);
      if (m) return { type: 'inlineMath', raw: m[0], text: m[1] };
    },
    renderer(tok) { return tex(tok.text, false); }
  };
  const CALLOUT_META = {
    note:       { icon: 'ℹ️', label: '说明' },
    tip:        { icon: '💡', label: '要点' },
    warn:       { icon: '⚠️', label: '注意' },
    danger:     { icon: '🔥', label: '易错' },
    correction: { icon: '✏️', label: '勘误 · 原笔记有误' },
    deep:       { icon: '🧬', label: '深入一层（选读）' }
  };
  const extCallout = {
    name: 'callout', level: 'block',
    start(src) { const i = src.indexOf(':::'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^:::(note|tip|warn|danger|correction|deep)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);
      if (!m) return;
      const tok = { type: 'callout', raw: m[0], kind: m[1], title: (m[2] || '').trim(), tokens: [] };
      this.lexer.blockTokens(m[3], tok.tokens);
      return tok;
    },
    renderer(tok) {
      const meta = CALLOUT_META[tok.kind];
      const title = tok.title || meta.label;
      const body = this.parser.parse(tok.tokens);
      if (tok.kind === 'deep') {
        return '<div class="callout deep"><div class="co-title" onclick="this.parentNode.classList.toggle(\'open\')">' +
          meta.icon + ' ' + escapeHtml(title) + ' <span style="margin-left:auto;font-size:11px">展开 ▾</span></div><div class="co-body">' + body + '</div></div>';
      }
      return '<div class="callout ' + tok.kind + '"><div class="co-title">' + meta.icon + ' ' + escapeHtml(title) + '</div>' + body + '</div>';
    }
  };
  let QUIZ_SEQ = 0;
  const extQuiz = {
    name: 'quiz', level: 'block',
    start(src) { const i = src.indexOf(':::quiz'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^:::quiz[ \t]*([^\n]*)\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/.exec(src);
      if (!m) return;
      const questions = [];
      let cur = null;
      m[2].split('\n').forEach(line => {
        const q = /^Q[:：]\s*(.+)$/.exec(line);
        const o = /^-\s*\[( |x|X)\]\s*(.+)$/.exec(line);
        const e = /^E[:：]\s*(.+)$/.exec(line);
        if (q) { cur = { q: q[1], opts: [], exp: '' }; questions.push(cur); }
        else if (o && cur) cur.opts.push({ text: o[2], right: o[1].toLowerCase() === 'x' });
        else if (e && cur) cur.exp = e[1];
        else if (cur && line.trim()) {          // 续行归入上一字段
          if (cur.exp) cur.exp += ' ' + line.trim();
          else if (cur.opts.length) cur.opts[cur.opts.length - 1].text += ' ' + line.trim();
          else cur.q += ' ' + line.trim();
        }
      });
      return { type: 'quiz', raw: m[0], title: (m[1] || '').trim(), questions };
    },
    renderer(tok) {
      const inline = s => marked.parseInline(s);
      let h = '<div class="quiz"><div class="quiz-head">📝 ' + escapeHtml(tok.title || '小测验 · 检验一下') + '</div>';
      tok.questions.forEach((qq, qi) => {
        const multi = qq.opts.filter(o => o.right).length > 1;
        const qid = 'qz' + (++QUIZ_SEQ);
        h += '<div class="quiz-q" data-qid="' + qid + '" data-multi="' + (multi ? 1 : 0) + '">';
        h += '<div class="qq-text">' + (qi + 1) + '. ' + inline(qq.q) + (multi ? ' <span style="font-weight:400;font-size:12px;color:var(--ink-3)">(多选)</span>' : '') + '</div>';
        qq.opts.forEach((o, oi) => {
          h += '<div class="quiz-opt" data-right="' + (o.right ? 1 : 0) + '"><span class="qo-mark">' + String.fromCharCode(65 + oi) + '</span><span>' + inline(o.text) + '</span></div>';
        });
        h += '<div class="quiz-actions"><button class="quiz-check">提交答案</button><span class="quiz-result"></span></div>';
        h += '<div class="quiz-exp">💬 ' + inline(qq.exp || '') + '</div>';
        h += '</div>';
      });
      return h + '</div>';
    }
  };

  marked.use({ gfm: true, breaks: false, extensions: [extBlockMath, extInlineMath, extCallout, extQuiz] });

  /* ---------- 渲染入口 ---------- */
  const $content = document.getElementById('content');
  const $pagenav = document.getElementById('pagenav');
  const $toc = document.getElementById('toc');
  const $sidebar = document.getElementById('sidebar');

  function render() {
    const hash = location.hash || '#/';
    const chm = /^#\/ch\/([\w-]+)/.exec(hash);
    QUIZ_SEQ = 0;
    if (hash.startsWith('#/unlock') && !PROMO) renderUnlockPage(null);
    else if (chm && CH_INDEX[chm[1]] !== undefined) {
      if (isLocked(chm[1])) renderUnlockPage(chm[1]);
      else renderChapter(chm[1]);
    }
    else renderHome();
    renderSidebar();
    document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    const done = store.done;
    const total = ORDER.length;
    const ndone = ORDER.filter(c => done[c.id]).length;
    const nquiz = Object.values(CHAPTERS).reduce((n, md) => n + (md.match(/^:::quiz/gm) || []).length, 0);
    const nimg = Object.values(CHAPTERS).reduce((n, md) => n + (md.match(/!\[[^\]]*\]\(/g) || []).length, 0);
    const next = ORDER.find(c => !done[c.id]) || ORDER[0];

    let h = '<div class="hero">';
    h += '<h1>' + escapeHtml(MANIFEST.site.title) + '</h1>';
    h += '<p class="hero-sub">' + escapeHtml(MANIFEST.site.subtitle) + '</p>';
    h += '<div class="hero-badges">';
    h += '<span class="badge">📚 ' + MANIFEST.parts.length + ' 个部分 · ' + total + ' 章</span>';
    h += '<span class="badge">🖼 ' + nimg + ' 张图解</span>';
    h += '<span class="badge">📝 ' + nquiz + ' 组测验</span>';
    if (!UNLOCKED && !PROMO) h += '<span class="badge free-badge">🆓 ' + ORDER.filter(c => FREE[c.id]).length + ' 章免费试读</span>';
    if (PROMO) h += '<span class="badge free-badge">🎁 限时全站免费</span>';
    h += '</div>';
    if (next) h += '<p style="margin-top:22px"><a class="quiz-check" style="text-decoration:none;padding:10px 30px;font-size:15px" href="#/ch/' + next.id + '">' + (ndone ? '▶ 继续学习：' + escapeHtml(next.title) : '🚀 开始学习') + '</a></p>';
    h += '</div>';

    h += '<div class="home-stats">';
    h += '<div class="stat"><div class="st-num">' + Math.round(ndone / total * 100) + '%</div><div class="st-label">学习进度</div></div>';
    h += '<div class="stat"><div class="st-num">' + ndone + '/' + total + '</div><div class="st-label">已完成章节</div></div>';
    h += '</div>';

    if (PROMO) {
      h += '<div class="unlock-banner"><div><b>🎁 限时全站免费开放</b><span> · 全部 ' + ORDER.length + ' 章内容均可阅读，欢迎学习与分享</span></div></div>';
    } else if (!UNLOCKED) {
      h += '<div class="unlock-banner"><div><b>🔓 解锁完整版</b><span> · 其余 ' + ORDER.filter(c => !FREE[c.id]).length + ' 章硬核内容（GRPO 逐行拆解 / verl 全 8 章 / DeepSeek 精读 / CUDA）</span></div>' +
        '<a class="buy-btn sm" href="#/unlock">¥' + escapeHtml(String(MANIFEST.site.price || '')) + ' 解锁</a></div>';
    }

    MANIFEST.parts.forEach((p, pi) => {
      const pdone = (p.chapters || []).filter(c => done[c.id]).length;
      h += '<div class="part-card"><div class="pc-head"><span class="pc-icon">' + p.icon + '</span><h3>Part ' + pi + ' · ' + escapeHtml(p.title) + '</h3>';
      h += '<span class="pc-meta">' + pdone + '/' + (p.chapters || []).length + ' 完成</span></div>';
      h += '<p class="pc-desc">' + escapeHtml(p.desc || '') + '</p><ol>';
      (p.chapters || []).forEach((c, ci) => {
        const mark = done[c.id] ? '<span class="ok">✓</span>' : (isLocked(c.id) ? '<span class="lk">🔒</span>' : '');
        h += '<li><a href="#/ch/' + c.id + '"><span class="n">' + String(ci + 1).padStart(2, '0') + '</span><span>' + escapeHtml(c.title) + '</span>' + mark + '</a></li>';
      });
      h += '</ol></div>';
    });

    $content.innerHTML = h;
    $pagenav.innerHTML = '';
    $toc.innerHTML = '';
    document.title = MANIFEST.site.title + ' · ' + MANIFEST.site.subtitle;
  }

  /* ---------- 解锁页（付费章节拦截 / #/unlock） ---------- */
  function renderUnlockPage(lockedId) {
    const price = MANIFEST.site.price || '59.9';
    const buyUrl = MANIFEST.site.buyUrl || '';
    const buyReady = !!buyUrl && !buyUrl.startsWith('REPLACE');
    const nPaid = ORDER.filter(c => !FREE[c.id]).length;
    const nFree = ORDER.length - nPaid;
    const info = lockedId ? ORDER[CH_INDEX[lockedId]] : null;

    if (UNLOCKED) {
      $content.innerHTML = '<div class="unlock-card"><div class="ul-lock">🎉</div><h1>完整版已解锁</h1>' +
        '<p class="ul-sub">全部 ' + ORDER.length + ' 章都可以阅读了，学习愉快！</p>' +
        '<p><a class="buy-btn" href="#/">回到目录</a></p></div>';
      $pagenav.innerHTML = ''; $toc.innerHTML = '';
      document.title = '已解锁 · ' + MANIFEST.site.title;
      return;
    }

    let h = '<div class="unlock-card">';
    h += '<div class="ul-lock">🔒</div>';
    h += info
      ? '<h1>《' + escapeHtml(info.title) + '》是付费章节</h1>'
      : '<h1>解锁完整版</h1>';
    if (info) h += '<div style="margin:6px 0 0"><span class="badge">' + info.icon + ' ' + escapeHtml(info.partTitle) + '</span> <span class="badge diff">' + (DIFF_LABEL[info.difficulty] || '') + '</span></div>';
    h += '<p class="ul-sub">' + nFree + ' 章免费试读（每个部分都有开篇章），一次付费解锁其余 <b>' + nPaid + ' 章</b>全部内容与后续更新。</p>';
    h += '<ul class="ul-points"><li>🔬 Transformer 深水区：RoPE 推导 · 四种 Mask · KV Cache→MLA · DeepSeek 精读</li>' +
      '<li>🧪 后训练全链：PPO/GRPO/DAPO/R1 · per-token logp 逐行拆解 · on-policy 蒸馏</li>' +
      '<li>🛠 verl 实战 8 章：单控制器 · Hybrid Engine · TransferQueue · Agentic RL</li>' +
      '<li>⚡ CUDA 与算子、分布式训练、推理引擎、64 条勘误总表</li></ul>';
    h += '<div class="ul-price">¥ <b>' + escapeHtml(String(price)) + '</b><span> 一次买断 · 永久阅读</span></div>';
    h += buyReady
      ? '<a class="buy-btn" href="' + buyUrl + '" target="_blank" rel="noopener">去购买（微信 / 支付宝）</a>'
      : '<a class="buy-btn disabled" href="javascript:void(0)">购买通道即将开放</a>';
    h += '<p class="ul-hint">购买后自动发货激活码，回到本页输入即可解锁。</p>';
    h += '<div class="ul-divider">已购买？输入激活码</div>';
    h += '<div class="ul-input-row"><input id="code-input" placeholder="LLMS-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false">' +
      '<button id="code-btn" class="buy-btn" style="margin:0">解锁</button></div>';
    h += '<div id="code-msg" class="ul-msg"></div>';
    h += '<p class="ul-hint" style="margin-top:14px">激活码与阅读进度只存在浏览器本地；换设备/换浏览器重新输入激活码即可。</p>';
    h += '</div>';

    $content.innerHTML = h;
    $pagenav.innerHTML = ''; $toc.innerHTML = '';
    document.title = (info ? info.title + ' · ' : '') + '解锁完整版 · ' + MANIFEST.site.title;

    const $in = document.getElementById('code-input');
    const $msg = document.getElementById('code-msg');
    const doUnlock = () => {
      $msg.textContent = '校验中…'; $msg.className = 'ul-msg';
      setTimeout(() => {
        let r;
        try { r = tryUnlock($in.value); } catch (e) { r = { ok: false, msg: '解锁异常：' + e.message }; }
        if (r.ok) {
          rebuildSearchIndex();
          $msg.textContent = '✓ 解锁成功！'; $msg.className = 'ul-msg ok';
          setTimeout(() => { if (lockedId) render(); else location.hash = '#/'; }, 600);
        } else {
          $msg.textContent = r.msg; $msg.className = 'ul-msg bad';
        }
      }, 30);
    };
    document.getElementById('code-btn').addEventListener('click', doUnlock);
    $in.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
    $in.focus();
  }

  /* ---------- 章节页 ---------- */
  const DIFF_LABEL = { 1: '★ 入门', 2: '★★ 进阶', 3: '★★★ 硬核' };
  function renderChapter(id) {
    const info = ORDER[CH_INDEX[id]];
    const md = CHAPTERS[id];
    let html;
    try { html = marked.parse(md); }
    catch (e) { html = '<p>渲染失败：' + escapeHtml(String(e)) + '</p>'; }

    const done = store.done;
    let meta = '<div class="ch-meta"><span class="badge">' + info.icon + ' ' + escapeHtml(info.partTitle) + '</span>' +
      '<span class="badge diff">' + (DIFF_LABEL[info.difficulty] || DIFF_LABEL[1]) + '</span>' +
      '<span>第 ' + (CH_INDEX[id] + 1) + ' / ' + ORDER.length + ' 章</span></div>';

    // 源材料脚注
    let src = '';
    if (info.sources.length) {
      src = '<div class="sources-box"><div class="sb-title">📎 本章源材料</div><ul>' +
        info.sources.map(s => {
          if (typeof s === 'string') return '<li>' + escapeHtml(s) + '</li>';
          return '<li>' + (s.url ? '<a href="' + s.url + '" target="_blank" rel="noopener">' + escapeHtml(s.title) + '</a>' : escapeHtml(s.title)) + (s.note ? ' — ' + escapeHtml(s.note) : '') + '</li>';
        }).join('') + '</ul></div>';
    }

    $content.innerHTML = meta + html + src +
      '<div class="chapter-done-wrap"><button class="chapter-done' + (done[id] ? ' done' : '') + '" id="btn-done">' +
      (done[id] ? '✓ 已完成本章' : '完成本章，做个标记') + '</button></div>';

    // 完成按钮
    document.getElementById('btn-done').addEventListener('click', function () {
      store.toggleDone(id);
      const d = store.done[id];
      this.classList.toggle('done', !!d);
      this.textContent = d ? '✓ 已完成本章' : '完成本章，做个标记';
      renderSidebar();
    });

    // 上一章 / 下一章
    const i = CH_INDEX[id];
    const prev = ORDER[i - 1], next = ORDER[i + 1];
    $pagenav.innerHTML = '<div class="pn">' +
      (prev ? '<a href="#/ch/' + prev.id + '"><div class="pn-dir">← 上一章</div><div class="pn-title">' + escapeHtml(prev.title) + '</div></a>' : '<span style="flex:1"></span>') +
      (next ? '<a class="next" href="#/ch/' + next.id + '"><div class="pn-dir">下一章 →</div><div class="pn-title">' + escapeHtml(next.title) + '</div></a>' : '<span style="flex:1"></span>') +
      '</div>';

    postRender();
    buildToc();
    document.title = info.title + ' · ' + MANIFEST.site.title;
  }

  /* ---------- 渲染后处理：代码高亮 / 图片 / 测验 ---------- */
  function postRender() {
    // 代码高亮 + 语言标签 + 复制按钮
    $content.querySelectorAll('pre code').forEach(code => {
      hljs.highlightElement(code);
      const pre = code.parentElement;
      const lang = (code.className.match(/language-(\w+)/) || [])[1];
      if (lang) {
        const tag = document.createElement('span');
        tag.className = 'code-lang'; tag.textContent = lang;
        pre.appendChild(tag);
      }
      const btn = document.createElement('button');
      btn.className = 'code-copy'; btn.textContent = '复制';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = '复制', 1500);
        });
      });
      pre.appendChild(btn);
    });

    // 图片：alt 作为图注 + 灯箱
    $content.querySelectorAll('img').forEach(img => {
      if (img.alt && !img.closest('figure')) {
        const fig = document.createElement('figure');
        img.replaceWith(fig);
        fig.appendChild(img);
        const cap = document.createElement('figcaption');
        cap.textContent = img.alt;
        fig.appendChild(cap);
      }
      img.addEventListener('click', () => showLightbox(img.src));
      img.loading = 'lazy';
    });

    // 测验交互
    $content.querySelectorAll('.quiz-q').forEach(qq => {
      const multi = qq.dataset.multi === '1';
      qq.querySelectorAll('.quiz-opt').forEach(opt => {
        opt.addEventListener('click', () => {
          if (qq.dataset.answered) return;
          if (!multi) qq.querySelectorAll('.quiz-opt').forEach(o => o.classList.remove('sel'));
          opt.classList.toggle('sel');
        });
      });
      qq.querySelector('.quiz-check').addEventListener('click', () => {
        if (qq.dataset.answered) return;
        const opts = [...qq.querySelectorAll('.quiz-opt')];
        if (!opts.some(o => o.classList.contains('sel'))) return;
        qq.dataset.answered = '1';
        let allRight = true;
        opts.forEach(o => {
          const right = o.dataset.right === '1', sel = o.classList.contains('sel');
          if (right) o.classList.add('right');
          if (sel && !right) { o.classList.add('wrong'); allRight = false; }
          if (!sel && right) allRight = false;
        });
        const res = qq.querySelector('.quiz-result');
        res.textContent = allRight ? '回答正确 🎉' : '再想想，看看解析';
        res.className = 'quiz-result ' + (allRight ? 'ok' : 'bad');
        qq.querySelector('.quiz-exp').classList.add('show');
        qq.querySelector('.quiz-check').style.display = 'none';
      });
    });
  }

  /* ---------- 右侧 TOC + scrollspy ---------- */
  let tocObserver = null;
  function buildToc() {
    const heads = [...$content.querySelectorAll('h2, h3')];
    if (!heads.length) { $toc.innerHTML = ''; return; }
    const used = {};
    let h = '<div class="toc-title">本章导航</div>';
    heads.forEach(el => {
      if (!el.id) {
        let s = el.textContent.trim().toLowerCase().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sec';
        while (used[s]) s += '-x';
        used[s] = 1; el.id = s;
      }
      h += '<a href="#' + el.id + '" data-target="' + el.id + '" class="' + (el.tagName === 'H3' ? 'lv3' : '') + '">' + escapeHtml(el.textContent) + '</a>';
    });
    $toc.innerHTML = h;
    // 点击平滑滚动（hash 路由下用 scrollIntoView，不改地址栏路由部分）
    $toc.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById(a.dataset.target).scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    if (tocObserver) tocObserver.disconnect();
    tocObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          $toc.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.target === en.target.id));
        }
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    heads.forEach(el => tocObserver.observe(el));
  }

  /* ---------- 侧边栏 ---------- */
  function renderSidebar() {
    const done = store.done;
    const total = ORDER.length;
    const ndone = ORDER.filter(c => done[c.id]).length;
    const cur = (/^#\/ch\/([\w-]+)/.exec(location.hash) || [])[1];

    let h = '<div class="side-progress"><div class="sp-nums"><span>学习进度</span><span>' + ndone + ' / ' + total + '</span></div>' +
      '<div class="sp-bar"><div style="width:' + (ndone / total * 100) + '%"></div></div>' +
      (PROMO
        ? ''
        : (UNLOCKED
          ? '<div class="sp-unlock ok">✓ 完整版已解锁</div>'
          : '<a class="sp-unlock" href="#/unlock">🔓 解锁完整版 ¥' + escapeHtml(String(MANIFEST.site.price || '')) + '</a>')) +
      '</div>';

    MANIFEST.parts.forEach((p, pi) => {
      const isOpen = (p.chapters || []).some(c => c.id === cur) || (!cur && pi === 0);
      h += '<div class="part' + (isOpen ? ' open' : '') + '">';
      h += '<button class="part-head"><span class="p-icon">' + p.icon + '</span><span>Part ' + pi + ' · ' + escapeHtml(p.title) + '</span><span class="p-arrow">▶</span></button>';
      h += '<ul class="part-chapters">';
      (p.chapters || []).forEach(c => {
        const mark = done[c.id] ? '<span class="ch-done">✓</span>' : (isLocked(c.id) ? '<span class="ch-lock">🔒</span>' : '');
        h += '<li><a class="ch-link' + (c.id === cur ? ' active' : '') + '" href="#/ch/' + c.id + '">' +
          '<span>' + escapeHtml(c.title) + '</span>' + mark + '</a></li>';
      });
      h += '</ul></div>';
    });
    $sidebar.innerHTML = h;
    $sidebar.querySelectorAll('.part-head').forEach(btn => {
      btn.addEventListener('click', () => btn.parentElement.classList.toggle('open'));
    });
    const act = $sidebar.querySelector('.ch-link.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- 搜索 ---------- */
  const $si = document.getElementById('search-input');
  const $sr = document.getElementById('search-results');
  const SEARCH_TEXT = {};   // id -> 纯文本（仅已解锁内容）
  function rebuildSearchIndex() {
    ORDER.forEach(c => {
      SEARCH_TEXT[c.id] = (CHAPTERS[c.id] || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\$\$[\s\S]*?\$\$/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/[#>*`~\[\]|:-]+/g, ' ')
        .replace(/\s+/g, ' ');
    });
  }
  rebuildSearchIndex();
  function doSearch(q) {
    q = q.trim();
    if (!q) { $sr.hidden = true; return; }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    ORDER.forEach(c => {
      const txt = SEARCH_TEXT[c.id], low = txt.toLowerCase(), tl = c.title.toLowerCase();
      let score = 0, firstIdx = -1;
      for (const t of terms) {
        const inTitle = tl.includes(t);
        const idx = low.indexOf(t);
        if (!inTitle && idx < 0) { score = 0; break; }
        score += inTitle ? 12 : 0;
        if (idx >= 0) {
          score += Math.min(8, (low.split(t).length - 1));
          if (firstIdx < 0) firstIdx = idx;
        }
      }
      if (score > 0) {
        let snippet = '';
        if (firstIdx >= 0) {
          const s = Math.max(0, firstIdx - 34);
          snippet = (s > 0 ? '…' : '') + txt.slice(s, firstIdx + 66) + '…';
        }
        hits.push({ c, score, snippet });
      }
    });
    hits.sort((a, b) => b.score - a.score);
    if (!hits.length) { $sr.innerHTML = '<div class="sr-empty">没有找到「' + escapeHtml(q) + '」相关内容</div>'; $sr.hidden = false; return; }
    const mark = s => { let r = escapeHtml(s); terms.forEach(t => { r = r.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }); return r; };
    $sr.innerHTML = hits.slice(0, 16).map(hh =>
      '<a class="sr-item" href="#/ch/' + hh.c.id + '"><div class="sr-title">' + mark(hh.c.title) + '<span class="sr-part">' + escapeHtml(hh.c.partTitle) + '</span></div>' +
      (hh.snippet ? '<div class="sr-snippet">' + mark(hh.snippet) + '</div>' : '') + '</a>').join('');
    $sr.hidden = false;
  }
  let searchTimer;
  $si.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch($si.value), 120); });
  $si.addEventListener('focus', () => { if ($si.value.trim()) doSearch($si.value); });
  document.addEventListener('click', e => { if (!e.target.closest('#search-wrap')) $sr.hidden = true; });
  $sr.addEventListener('click', e => { if (e.target.closest('.sr-item')) { $sr.hidden = true; $si.blur(); } });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $si.focus(); $si.select(); }
    if (e.key === 'Escape') { $sr.hidden = true; $si.blur(); }
  });

  /* ---------- 灯箱 ---------- */
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = '<img>';
  document.body.appendChild(lb);
  function showLightbox(src) { lb.querySelector('img').src = src; lb.classList.add('show'); }
  lb.addEventListener('click', () => lb.classList.remove('show'));

  /* ---------- 阅读进度条 ---------- */
  const pb = document.getElementById('progressbar');
  addEventListener('scroll', () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    pb.style.width = (max > 0 ? (h.scrollTop / max * 100) : 0) + '%';
  }, { passive: true });

  /* ---------- 移动端目录开关 ---------- */
  document.getElementById('nav-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.getElementById('sidebar-mask').addEventListener('click', () => document.body.classList.remove('nav-open'));

  /* ---------- 键盘翻页 ---------- */
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const cur = (/^#\/ch\/([\w-]+)/.exec(location.hash) || [])[1];
    if (!cur) return;
    const i = CH_INDEX[cur];
    if (e.key === 'ArrowLeft' && ORDER[i - 1]) location.hash = '#/ch/' + ORDER[i - 1].id;
    if (e.key === 'ArrowRight' && ORDER[i + 1]) location.hash = '#/ch/' + ORDER[i + 1].id;
  });

  addEventListener('hashchange', render);
  render();
})();
