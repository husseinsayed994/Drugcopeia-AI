/*
 * Dawaya AI - the chat screen.
 *
 * This file is only presentation. Every question still goes through
 * DawayaAIAssistant.ask(): the seven steps, the model, the output guard and the
 * fixed sources/disclaimer all live there. Here we render what came back, and
 * we never turn model text into HTML.
 *
 * Exposed as DawayaAIChat.
 */
(function (global) {
  'use strict';

  const ASSET_BASE = 'assets/ai/';
  const MAX_QUESTION = 400;

  let dom = null;
  let messages = null;
  let language = 'ar';
  let initializing = null;
  let indexed = false;
  let asking = false;
  let turns = [];
  let pending = null;
  let progressTimer = 0;
  let deleteArmed = 0;
  let opened = false;
  let lastResult = null;

  const $ = id => (dom ? dom[id] : null);
  const runtime = () => global.DawayaAIRuntime;
  const model = () => global.DawayaAIModel;
  const privacy = () => global.DawayaPrivacy;
  const app = () => global.DawayaApp || null;

  /* ---------- fixed messages (never from the model) ---------- */

  function bundle() {
    return (messages && messages[language]) || (messages && messages.ar) || {};
  }

  function text(path, vars) {
    const parts = String(path).split('.');
    let node = bundle();
    for (const part of parts) {
      if (node && typeof node === 'object' && part in node) node = node[part];
      else return String(path);
    }
    if (typeof node !== 'string') return '';
    let out = node;
    for (const [key, value] of Object.entries(vars || {})) out = out.split(`{${key}}`).join(String(value));
    return out;
  }

  function disclaimer() {
    return bundle().disclaimer || '';
  }

  function bytes(value) {
    const size = Number(value || 0);
    if (!size) return '0 MB';
    if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${Math.round(size / (1024 * 1024))} MB`;
  }

  /* ---------- boot ---------- */

  function boot() {
    if (initializing) return initializing;
    initializing = (async () => {
      cacheDom();
      if (!dom || !dom.page) return;
      bind();
      try {
        const assets = await global.DawayaAIAssistant.loadAssets(ASSET_BASE);
        messages = assets.messages;
        const meta = await fetch(`${ASSET_BASE}dataset-meta.json`, { cache: 'force-cache' })
          .then(response => (response.ok ? response.json() : null))
          .catch(() => null);
        assets.datasetMeta = meta;
        language = (app() && app().language) || (document.documentElement.lang === 'en' ? 'en' : 'ar');
        configure(assets);
        applyLanguage(language);
        model().attachLifecycle();
        await model().initialize();
        renderModel();
        renderHistory();
      } catch (error) {
        console.warn('Dawaya assistant could not start:', error && error.message ? error.message : error);
        renderFatal();
      }
    })();
    return initializing;
  }

  function configure(assets) {
    const retrieval = global.DawayaAIRetrieval;
    const safety = global.DawayaAISafety;
    const assistant = global.DawayaAIAssistant;
    retrieval.configure(assets.policy.retrieval);
    safety.configure({ policy: assets.policy, entities: retrieval.entities });
    model().configure({
      model: assets.modelConfig,
      generation: assets.modelConfig.generation,
      storage: global.DawayaCore && global.DawayaCore.storage
    });
    assistant.configure({
      policy: assets.policy,
      messages: assets.messages,
      prompts: assets.prompts,
      retrieval,
      safety,
      model: model(),
      runtime: runtime(),
      language,
      storage: global.DawayaCore && global.DawayaCore.storage,
      onStage: stage => {
        if (stage && stage.name) paintStage(stage.name);
      }
    });
    assistant.assets = assets;
  }

  function cacheDom() {
    dom = {
      page: document.getElementById('assistantPage'),
      kicker: document.getElementById('aiKicker'),
      title: document.getElementById('aiPageTitle'),
      subtitle: document.getElementById('aiPageSubtitle'),
      status: document.getElementById('aiStatus'),
      statusText: document.getElementById('aiStatusText'),
      panel: document.getElementById('aiModelPanel'),
      modelTitle: document.getElementById('aiModelTitle'),
      modelBody: document.getElementById('aiModelBody'),
      modelSize: document.getElementById('aiModelSize'),
      wifiTitle: document.getElementById('aiWifiTitle'),
      wifiBody: document.getElementById('aiWifiBody'),
      storageTitle: document.getElementById('aiStorageTitle'),
      storageBody: document.getElementById('aiStorageBody'),
      privacyTitle: document.getElementById('aiPrivacyTitle'),
      privacyBody: document.getElementById('aiPrivacyBody'),
      progress: document.getElementById('aiProgress'),
      progressBar: document.getElementById('aiProgressBar'),
      progressWrap: document.getElementById('aiProgressBarWrap'),
      progressText: document.getElementById('aiProgressText'),
      offlineNote: document.getElementById('aiOfflineNote'),
      errorNote: document.getElementById('aiErrorNote'),
      start: document.getElementById('aiStart'),
      pause: document.getElementById('aiPause'),
      resume: document.getElementById('aiResume'),
      retry: document.getElementById('aiRetry'),
      cancel: document.getElementById('aiCancelDownload'),
      importButton: document.getElementById('aiImport'),
      advancedSummary: document.getElementById('aiAdvancedSummary'),
      importBody: document.getElementById('aiImportBody'),
      cachedNote: document.getElementById('aiCachedNote'),
      deleteModel: document.getElementById('aiDeleteModel'),
      smart: document.getElementById('aiSmartBanner'),
      smartTitle: document.getElementById('aiSmartTitle'),
      smartWhy: document.getElementById('aiSmartWhy'),
      log: document.getElementById('aiLog'),
      form: document.getElementById('aiComposer'),
      input: document.getElementById('aiInput'),
      inputLabel: document.getElementById('aiInputLabel'),
      hint: document.getElementById('aiHint'),
      send: document.getElementById('aiSend'),
      stop: document.getElementById('aiStop'),
      attach: document.getElementById('aiAttach'),
      photoInput: document.getElementById('aiPhotoInput'),
      attachPreview: document.getElementById('aiAttachPreview'),
      attachThumb: document.getElementById('aiAttachThumb'),
      attachState: document.getElementById('aiAttachState'),
      attachRemove: document.getElementById('aiAttachRemove'),
      menuButton: document.getElementById('aiMenuButton'),
      menuBackdrop: document.getElementById('aiMenuBackdrop'),
      menu: document.getElementById('aiAssistantMenu'),
      menuClose: document.getElementById('aiMenuClose'),
      menuTitle: document.getElementById('aiMenuTitle'),
      menuConversationsKicker: document.getElementById('aiMenuConversationsKicker'),
      menuNewChat: document.getElementById('aiMenuNewChat'),
      menuNewChatLabel: document.querySelector('#aiMenuNewChat .drawer-link-label'),
      menuSessions: document.getElementById('aiMenuSessions'),
      menuSessionsEmpty: document.getElementById('aiMenuSessionsEmpty'),
      menuHistoryTitle: document.getElementById('aiMenuHistoryTitle'),
      menuHistoryToggle: document.getElementById('aiMenuHistoryToggle'),
      menuHistoryLabel: document.getElementById('aiMenuHistoryLabel'),
      menuNote: document.getElementById('aiMenuNote'),
      menuSettingsButton: document.getElementById('aiMenuSettings'),
      menuSettingsLabel: document.getElementById('aiMenuSettingsLabel'),
      menuSettingsPanel: document.getElementById('aiMenuSettingsPanel'),
      menuModelLine: document.getElementById('aiMenuModelLine'),
      menuLeanLine: document.getElementById('aiMenuLeanLine'),
      menuModel: document.getElementById('aiMenuModel'),
      menuManage: document.getElementById('aiMenuManage')
    };
  }

  function bind() {
    if (dom.__bound) return;
    dom.__bound = true;
    dom.form.addEventListener('submit', event => {
      event.preventDefault();
      submit();
    });
    dom.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      if (event.shiftKey || coarsePointer()) return;
      event.preventDefault();
      submit();
    });
    dom.input.addEventListener('input', autoGrow);
    dom.stop.addEventListener('click', stopGeneration);
    if (dom.attach) dom.attach.addEventListener('click', openPhotoPicker);
    if (dom.photoInput) dom.photoInput.addEventListener('change', () => takePhoto(dom.photoInput.files && dom.photoInput.files[0]));
    if (dom.attachRemove) dom.attachRemove.addEventListener('click', clearPhoto);
    dom.start.addEventListener('click', () => startDownload(false));
    dom.retry.addEventListener('click', () => startDownload(false));
    dom.pause.addEventListener('click', () => model().pauseDownload());
    dom.resume.addEventListener('click', () => model().resumeDownload());
    dom.cancel.addEventListener('click', () => model().cancelDownload());
    dom.importButton.addEventListener('click', importModel);
    dom.deleteModel.addEventListener('click', removeModel);
    dom.menuButton.addEventListener('click', () => (dom.menuBackdrop.hidden ? openMenu() : closeMenu()));
    dom.menuClose.addEventListener('click', closeMenu);
    dom.menuNewChat.addEventListener('click', async () => { await newChat(); renderMenuSessions(); });
    dom.menuHistoryToggle.addEventListener('change', async () => {
      await toggleHistory();
      renderMenuSettings();
    });
    dom.menuSettingsButton.addEventListener('click', toggleMenuSettings);
    dom.menu.addEventListener('keydown', trapMenuFocus);
    dom.menuManage.addEventListener('click', () => { closeMenu(); openPrivacy(); });
    dom.menuModel.addEventListener('click', () => {
      closeMenu();
      /* The model card sits directly under this header, so it never needs a page
         scroll - on phones scrollIntoView pans the locked document and strands the
         reader on a blank sheet. */
      if (dom.panel.hidden) { openPrivacy(); return; }
      if (typeof dom.panel.scrollIntoView === 'function' && window.innerWidth > 1023) dom.panel.scrollIntoView({ block: 'nearest' });
      dom.modelTitle.setAttribute('tabindex', '-1');
      dom.modelTitle.focus({ preventScroll: true });
    });
    document.addEventListener('click', event => {
      if (dom.menu.hidden) return;
      if (dom.menu.contains(event.target) || dom.menuButton.contains(event.target)) return;
      closeMenu();
    });
    dom.smart.addEventListener('click', event => {
      if (event.target.closest('button')) openPrivacy();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (dom.menu && !dom.menu.hidden) { closeMenu(); return; }
      if (asking) stopGeneration();
    });
    model().onState(() => {
      renderModel();
      renderStatus();
      renderMenuSettings();
    });
    model().onProgress(event => onProgress(event));
    if (app() && typeof app().onDatasetUpdate === 'function') {
      app().onDatasetUpdate(() => {
        indexed = false;
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderStatus();
    });
  }

  function coarsePointer() {
    return Boolean(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  }

  /* ---------- language and static labels ---------- */

  function applyLanguage(next) {
    if (!dom || !messages) return;
    language = next === 'en' ? 'en' : 'ar';
    const assistant = global.DawayaAIAssistant;
    if (assistant && assistant.assets) {
      assistant.configure({
        policy: assistant.assets.policy,
        messages: assistant.assets.messages,
        prompts: assistant.assets.prompts,
        retrieval: global.DawayaAIRetrieval,
        safety: global.DawayaAISafety,
        model: model(),
        runtime: runtime(),
        language,
        storage: global.DawayaCore && global.DawayaCore.storage,
        onStage: stage => {
          if (stage && stage.name) paintStage(stage.name);
        }
      });
    }
    dom.page.lang = language;
    const kicker = text('pageKicker');
    dom.kicker.textContent = kicker === 'pageKicker' ? text('pageTitle') : kicker;
    dom.title.textContent = text('pageTitle');
    dom.subtitle.textContent = text('pageSubtitle');
    dom.modelTitle.textContent = text('download.title');
    dom.modelBody.textContent = text('download.body', { size: bytes(modelSize()) });
    dom.modelSize.textContent = bytes(modelSize());
    dom.wifiTitle.textContent = text('download.wifiTitle');
    dom.wifiBody.textContent = text('download.wifiBody', { size: bytes(modelSize()) });
    dom.storageTitle.textContent = text('download.storageTitle');
    dom.storageBody.textContent = text('download.storageBody', { required: bytes(modelSize() * 1.4) });
    dom.privacyTitle.textContent = text('download.privacyTitle');
    dom.privacyBody.textContent = text('download.privacyBody');
    dom.start.textContent = text('download.start');
    dom.pause.textContent = text('download.pause');
    dom.resume.textContent = text('download.resume');
    dom.retry.textContent = text('download.retry');
    dom.cancel.textContent = text('download.cancel');
    dom.importButton.textContent = text('download.importButton');
    dom.advancedSummary.textContent = text('chat.advanced');
    dom.importBody.textContent = text('download.importBody', {
      fileName: fileName(),
      size: bytes(modelSize())
    });
    dom.cachedNote.textContent = text('download.cachedNote');
    dom.deleteModel.textContent = text('chat.deleteModel');
    dom.offlineNote.textContent = text('chat.offline');
    dom.smartTitle.textContent = text('capability.fallbackTitle');
    dom.input.placeholder = text('ui.inputPlaceholder');
    dom.input.setAttribute('aria-label', text('ui.ariaInput'));
    dom.inputLabel.textContent = text('ui.ariaInput');
    dom.hint.textContent = coarsePointer() ? '' : text('ui.enterHint');
    dom.send.textContent = text('ui.send');
    dom.send.setAttribute('aria-label', text('ui.ariaSend'));
    dom.stop.textContent = text('ui.stop');
    dom.stop.setAttribute('aria-label', text('ui.ariaStop'));
    renderAttach();
    dom.menuButton.setAttribute('aria-label', text('menu.aria'));
    dom.menuTitle.textContent = text('menu.title');
    dom.menuClose.setAttribute('aria-label', text('menu.closeAria'));
    dom.menuConversationsKicker.textContent = text('menu.conversations');
    dom.menuNewChatLabel.textContent = text('chat.newChat');
    dom.menuHistoryTitle.textContent = text('chat.historyTitle');
    dom.menuSettingsLabel.textContent = text('menu.settings');
    dom.menuManage.textContent = text('chat.manageHistory');
    dom.log.setAttribute('aria-label', text('ui.ariaLog'));
    renderStatus();
    renderModel();
    if (!asking) renderTurns();
    renderMenuSettings();
    if (dom.menu && !dom.menu.hidden) renderMenuSessions();
  }

  /* ---------- model status ---------- */

  function modelSize() {
    const assistant = global.DawayaAIAssistant;
    return Number(assistant && assistant.assets && assistant.assets.modelConfig.model.sizeBytes) || 1117320736;
  }

  function fileName() {
    const assistant = global.DawayaAIAssistant;
    return (assistant && assistant.assets && assistant.assets.modelConfig.model.fileName) || 'model.gguf';
  }

  function stateKey() {
    const states = model().STATES;
    const value = model().state;
    const map = {
      [states.NOT_DOWNLOADED]: 'notDownloaded',
      [states.DOWNLOADING]: 'downloading',
      [states.PAUSED]: 'paused',
      [states.VERIFYING]: 'verifying',
      [states.LOADING]: 'loading',
      [states.READY_TO_LOAD]: 'ready',
      [states.READY]: 'ready',
      [states.ERROR]: 'error',
      [states.UNSUPPORTED]: 'unsupported',
      [states.NO_RUNTIME]: 'smartSearchOnly'
    };
    return map[value] || 'smartSearchOnly';
  }

  function renderStatus() {
    if (!dom) return;
    const state = model().state;
    const states = model().STATES;
    let key = stateKey();
    let detail = '';
    if (asking) key = 'generating';
    if (state === states.LOADING) detail = text('load.loadingHint');
    if (state === states.NOT_DOWNLOADED && runtime().available()) key = 'notDownloaded';
    if (!runtime().available()) key = 'smartSearchOnly';
    dom.status.dataset.state = key;
    dom.statusText.textContent = text(`state.${key}`) + (detail ? ` — ${detail}` : '');
  }

  function renderModel() {
    if (!dom) return;
    const states = model().STATES;
    const state = model().state;
    const supported = Boolean(model().device && model().device.supported);
    const hasRuntime = runtime().available();
    const ready = state === states.READY || state === states.READY_TO_LOAD || state === states.LOADING;
    const visible = hasRuntime && state !== states.NO_RUNTIME && state !== states.UNSUPPORTED;
    dom.panel.hidden = !visible;
    dom.panel.dataset.ready = ready ? 'true' : 'false';
    dom.panel.dataset.downloading = state === states.DOWNLOADING || state === states.PAUSED ? 'true' : 'false';
    dom.smart.hidden = !(state === states.UNSUPPORTED || !hasRuntime);
    dom.panel.dataset.state = state;
    dom.start.hidden = !(state === states.NOT_DOWNLOADED);
    dom.retry.hidden = state !== states.ERROR;
    dom.pause.hidden = state !== states.DOWNLOADING;
    dom.resume.hidden = state !== states.PAUSED;
    dom.cancel.hidden = !(state === states.DOWNLOADING || state === states.PAUSED);
    dom.progress.hidden = !(state === states.DOWNLOADING || state === states.VERIFYING);
    dom.offlineNote.hidden = !(downloadRequiresOnline() && state === states.NOT_DOWNLOADED);
    dom.start.disabled = downloadRequiresOnline();
    dom.errorNote.hidden = state !== states.ERROR;
    if (state === states.ERROR) dom.errorNote.textContent = text('errors.generic');
    dom.deleteModel.hidden = !(state === states.READY || state === states.READY_TO_LOAD);
    dom.importButton.hidden = state === states.UNSUPPORTED || ready;
    if (state === states.VERIFYING) dom.progressText.textContent = text('state.verifying');
    dom.modelBody.textContent = ready
      ? text('chat.downloadReady')
      : text('download.body', { size: bytes(modelSize()) });
    /* The banner is one line: "Smart search will be used". Only a device that cannot
       run the model gets the reason under it, because that is the case where the
       reader needs to know what to change. */
    if (dom.smartWhy) {
      const showWhy = state === states.UNSUPPORTED;
      dom.smartWhy.hidden = !showWhy;
      if (showWhy) {
        const device = model().device || {};
        dom.smartWhy.textContent = device.reason === 'web-single-thread' ? text('capability.webWhy') : text('capability.why', {
          minRam: `${Math.round((device.minRamMb || 2600) / 1024)} GB`,
          ram: device.ramMb ? `${(device.ramMb / 1024).toFixed(1)} GB` : '—'
        });
      }
    }
    renderStatus();
  }

  function onProgress(event) {
    if (!dom || !event) return;
    if (event.state === model().STATES.ERROR) {
      dom.errorNote.hidden = false;
      dom.errorNote.textContent = text('errors.generic');
      return;
    }
    if (typeof event.percent === 'number') {
      dom.progress.hidden = false;
      dom.progressBar.style.width = `${Math.max(0, Math.min(100, event.percent))}%`;
      dom.progressWrap.setAttribute('aria-valuenow', String(Math.round(event.percent)));
      const done = Number(event.downloadedBytes || 0);
      const total = Number(event.totalBytes || modelSize());
      dom.progressText.textContent = text('download.progress', {
        percent: Math.round(event.percent),
        done: bytes(done),
        total: bytes(total)
      });
      if (pending && pending.textEl) paintPending();
    }
  }

  function paintStage(name) {
    if (!dom) return;
    if (name.startsWith('generate:skipped')) return;
    if (name === 'retrieve') renderStatus();
  }

  /* ---------- the medicine index ---------- */

  async function ensureIndexed() {
    if (indexed) return true;
    const source = app();
    if (!source) return false;
    const preparing = addBot({ role: 'assistant', text: '', system: true, preparing: true });
    dom.log.hidden = false;
    scrollSoon();
    try {
      const conditions = await source.loadConditionDatabase().catch(() => null);
      const knowledge = typeof source.loadKnowledgeIndex === 'function'
        ? await source.loadKnowledgeIndex().catch(() => null)
        : null;
      await waitForDrugs();
      global.DawayaAIRetrieval.build({
        drugs: source.drugs || [],
        conditions: { topics: conditions || source.conditions || [], meta: { source: 'MedlinePlus', retrieved: '2026-10-29', language: 'en' } },
        knowledge: knowledge || undefined,
        clinicalNotes: source.clinicalNotes || [],
        interactions: source.interactions || [],
        datasetMeta: (global.DawayaAIAssistant.assets && global.DawayaAIAssistant.assets.datasetMeta) || null
      });
      indexed = true;
      return true;
    } catch (error) {
      console.warn('Dawaya index build failed:', error && error.message ? error.message : error);
      return false;
    } finally {
      preparing.remove();
      paintPreparing(false);
    }
  }

  function waitForDrugs(timeoutMs) {
    const limit = timeoutMs || 15000;
    const started = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const source = app();
        if (source && Array.isArray(source.drugs) && source.drugs.length) return resolve(true);
        if (Date.now() - started > limit) return resolve(false);
        global.setTimeout(tick, 200);
      };
      tick();
    });
  }

  function paintPreparing(on) {
    if (!dom) return;
    if (on) dom.statusText.textContent = text('chat.preparing');
  }

  /* ---------- the conversation ---------- */

  function storeTurn(role, body) {
    turns.push({ role, ...body });
    if (turns.length > 40) turns.splice(0, turns.length - 40);
  }

  function renderTurns() {
    if (!dom) return;
    dom.log.textContent = '';
    for (const turn of turns) {
      if (turn.role === 'user') addUser(turn.text, false);
      else addBot(turn, false);
    }
    scrollSoon();
  }

  function addUser(value, scroll) {
    const article = document.createElement('article');
    article.className = 'ai-msg ai-msg-user';
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.textContent = value;
    article.append(bubble);
    dom.log.append(article);
    if (scroll) scrollSoon({ force: true });
    return article;
  }

  function addBot(turn, scroll) {
    const article = document.createElement('article');
    article.className = 'ai-msg ai-msg-bot';
    article.dataset.role = 'assistant';
    const avatar = document.createElement('span');
    avatar.className = 'ai-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 24 24');
    const markUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    markUse.setAttribute('href', '#icon-dawaya-ai');
    mark.append(markUse);
    avatar.append(mark);
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    if (turn.preparing) {
      const note = document.createElement('p');
      note.className = 'ai-preparing';
      note.textContent = `${text('chat.preparing')} ${text('chat.preparingHint')}`;
      bubble.append(note);
    }
    article.append(avatar, bubble);
    dom.log.append(article);
    turn.el = article;
    turn.bubble = bubble;
    if (turn.result) paintResult(turn);
    else if (turn.text) paintText(bubble, turn.text);
    if (scroll) scrollSoon({ force: true });
    return article;
  }

  function paintText(bubble, value) {
    /* The waiting line is only for the gap before the first token, so it leaves as
       soon as there is text to read instead of sitting above the answer. */
    const waiting = bubble.querySelector('.ai-typing');
    if (waiting) waiting.remove();
    let node = bubble.querySelector('.ai-text');
    if (!node) {
      node = document.createElement('div');
      node.className = 'ai-text';
      bubble.append(node);
    }
    node.textContent = value;
  }

  function paintResult(turn) {
    if (!dom || !turn.bubble) return;
    const result = turn.result || {};
    turn.bubble.textContent = '';
    turn.bubble.dataset.kind = result.type || 'answer';
    if (result.type === 'emergency') {
      const title = document.createElement('strong');
      title.className = 'ai-alert-title';
      title.textContent = result.title || text('emergency.title');
      turn.bubble.append(title);
    }
    const body = document.createElement('div');
    body.className = 'ai-text';
    body.dir = 'auto';
    const shown = String(result.text || turn.text || '');
    body.textContent = shown;
    turn.bubble.append(body);
    /* An answer the database could not ground says so in its own line, above everything else
       the reply carries: the reader has to know it is general knowledge before they read it. */
    if (result.type === 'general' && result.note) {
      const flag = document.createElement('p');
      flag.className = 'ai-general-note';
      const label = document.createElement('strong');
      label.textContent = `${result.label}: `;
      const line = document.createElement('span');
      line.textContent = result.note;
      flag.append(label, line);
      turn.bubble.append(flag);
    }
    if (result.pillars) {
      const list = document.createElement('ul');
      list.className = 'ai-pillars';
      for (const line of result.pillars || []) {
        const item = document.createElement('li');
        item.textContent = line;
        list.append(item);
      }
      turn.bubble.append(list);
    }
    if (result.ambulance) {
      const call = document.createElement('a');
      call.className = 'ai-call';
      call.href = `tel:${result.ambulance}`;
      call.textContent = text('chat.call', { phone: result.ambulance });
      turn.bubble.append(call);
    }
    if (result.type !== 'chat' && result.guard && Array.isArray(result.guard.reasons)) {
      const guardReasons = result.guard.reasons.map(reason => reason.code).filter(Boolean);
      if (guardReasons.length) {
        turn.bubble.dataset.guardReasons = guardReasons.join(',');
        const note = document.createElement('p');
        note.className = 'ai-inline-note';
        note.textContent = text('chat.cardFallback');
        turn.bubble.append(note);
      }
    }
    if (result.card) turn.bubble.append(renderCard(result.card));
    if (Array.isArray(result.flags) && result.flags.length) turn.bubble.append(renderFlags(result.flags));
    if (result.conflict && result.conflictNote) {
      const note = document.createElement('p');
      note.className = 'ai-conflict';
      note.textContent = result.conflictNote;
      turn.bubble.append(note);
    }
    if (Array.isArray(result.sources) && result.sources.length) turn.bubble.append(renderSources(result.sources));
    else if (result.sourcesAddedByCode) {
      const none = document.createElement('p');
      none.className = 'ai-source-none';
      none.textContent = text('answer.sourcesNone');
      turn.bubble.append(none);
    }
    if (Array.isArray(result.links) && result.links.length) {
      turn.bubble.append(renderLinks(result.links, result.linksTitle));
      if (result.doctorNote) {
        const note = document.createElement('p');
        note.className = 'ai-inline-note';
        note.textContent = result.doctorNote;
        turn.bubble.append(note);
      }
    }
    /* One notice per conversation, under the first answer it belongs to - the log itself is
       the record of whether it is there yet, so clearing the screen clears it with the rest.
       Repeating the same sentence under every reply in one chat reads as noise. */
    if ((result.disclaimer || result.sourcesAddedByCode) && !dom.log.querySelector('.ai-disclaimer')) {
      const foot = document.createElement('p');
      foot.className = 'ai-disclaimer';
      foot.textContent = result.disclaimer || disclaimer();
      turn.bubble.append(foot);
    }
    if (shown) turn.bubble.append(renderActions(turn));
  }

  function renderActions(turn) {
    const row = document.createElement('div');
    row.className = 'ai-msg-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ai-link-button';
    copy.textContent = text('chat.copy');
    copy.addEventListener('click', async () => {
      const ok = await copyText(String(turn.text || ''));
      copy.textContent = ok ? text('chat.copied') : text('chat.copy');
      global.setTimeout(() => { copy.textContent = text('chat.copy'); }, 1800);
    });
    row.append(copy);
    return row;
  }

  function renderCard(card) {
    const wrapper = document.createElement('section');
    wrapper.className = 'ai-card';
    const heading = document.createElement('h4');
    const documentsOnly = (card.documents || []).length > 0 && !(card.medicines || []).length;
    heading.textContent = card.focusLabel || text(documentsOnly ? 'answer.docCardLabel' : 'answer.cardLabel');
    wrapper.append(heading);
    if (card.focusNote) {
      const note = document.createElement('p');
      note.className = 'ai-card-note';
      note.textContent = card.focusNote;
      wrapper.append(note);
    }
    if (card.focusEmpty) {
      const empty = document.createElement('p');
      empty.className = 'ai-card-note';
      empty.textContent = card.focusEmpty;
      wrapper.append(empty);
    }
    for (const med of card.medicines || []) {
      const block = document.createElement('div');
      block.className = 'ai-card-med';
      const name = document.createElement('strong');
      name.className = 'ai-card-name';
      name.textContent = language==='en'?(med.tradeNameEn||med.tradeNameAr||''):(med.tradeNameAr||med.tradeNameEn||'');
      const en = document.createElement('span');
      en.className = 'ai-card-en';
      en.textContent = language==='en'?(med.tradeNameAr||''):(med.tradeNameEn&&med.tradeNameEn!==med.tradeNameAr?med.tradeNameEn:'');
      block.append(name, en);
      const rows = [
        ['active', med.ingredient],
        ['company', med.manufacturer],
        ['class', med.drugClass],
        ['price', med.priceEgp !== '' && med.priceEgp !== undefined ? `${med.priceEgp} EGP` : '']
      ];
      const dl = document.createElement('dl');
      dl.className = 'ai-card-facts';
      for (const [, value] of rows) {
        if (!value) continue;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dd);
      }
      block.append(dl);
      if (med.notes) {
        for (const key of ['mechanism', 'uses', 'effects', 'safety']) {
          if (!med.notes[key]) continue;
          const p = document.createElement('p');
          p.className = 'ai-card-note';
          p.textContent = med.notes[key];
          block.append(p);
        }
      }
      for (const use of med.monoUses || []) {
        const p = document.createElement('p');
        p.className = 'ai-card-note';
        p.textContent = `${use.title ? use.title + ' — ' : ''}${use.text || ''}`;
        block.append(p);
        if (use.source && use.source.dailymed) {
          const source = document.createElement('p');
          source.className = 'ai-card-source';
          const link = document.createElement('a');
          link.href = use.source.dailymed;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${use.source.name || 'DailyMed'} ${use.source.label_date || ''}`.trim();
          source.append(link);
          block.append(source);
        }
      }
      for (const pair of med.interactions || []) {
        const p = document.createElement('p');
        p.className = `ai-card-interaction is-${String(pair.severity || '').toLowerCase()}`;
        p.textContent = `${pair.severity || ''}: ${pair.other || ''} — ${pair.effect || ''}`;
        block.append(p);
      }
      for (const dose of med.dose || []) {
        const p = document.createElement('p');
        p.className = 'ai-card-note';
        p.textContent = `${dose.title ? dose.title + ' — ' : ''}${dose.text || ''}`;
        block.append(p);
        if (dose.source && dose.source.dailymed) {
          const source = document.createElement('p');
          source.className = 'ai-card-source';
          const link = document.createElement('a');
          link.href = dose.source.dailymed;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${dose.source.name || 'DailyMed'} ${dose.source.label_date || ''}`.trim();
          source.append(link);
          block.append(source);
        }
      }
      if (med.pregnancy) {
        for (const found of med.pregnancy.items || []) {
          const entry = found.entry || {};
          const pregText = language === 'en' ? (entry.preg_en || entry.preg_ar) : (entry.preg_ar || entry.preg_en);
          const lactText = language === 'en' ? (entry.lact_en || entry.lact_ar) : (entry.lact_ar || entry.lact_en);
          for (const value of [pregText, lactText]) {
            if (!value) continue;
            const p = document.createElement('p');
            p.className = 'ai-card-note';
            p.textContent = `${found.ingredient}: ${value}`;
            block.append(p);
          }
        }
        if (med.pregnancy.disclaimer) {
          const disc = document.createElement('p');
          disc.className = 'ai-card-note';
          disc.textContent = language === 'en' ? (med.pregnancy.disclaimer.en || med.pregnancy.disclaimer.ar || '') : (med.pregnancy.disclaimer.ar || med.pregnancy.disclaimer.en || '');
          if (disc.textContent) block.append(disc);
        }
      }
      for (const mono of med.monoPregnancy || []) {
        const p = document.createElement('p');
        p.className = 'ai-card-note';
        p.textContent = `${mono.title ? mono.title + ' — ' : ''}${mono.text || ''}`;
        block.append(p);
        if (mono.source && mono.source.dailymed) {
          const source = document.createElement('p');
          source.className = 'ai-card-source';
          const link = document.createElement('a');
          link.href = mono.source.dailymed;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${mono.source.name || 'DailyMed'} ${mono.source.label_date || ''}`.trim();
          source.append(link);
          block.append(source);
        }
      }
      if (med.sourceLabel) {
        const source = document.createElement('p');
        source.className = 'ai-card-source';
        source.textContent = language==='en'&&med.source?.internalDatabase?text('answer.databaseSource',{version:med.source.version||'not listed',date:med.source.date||'not listed'}):med.sourceLabel;
        block.append(source);
      }
      wrapper.append(block);
    }
    for (const doc of card.documents || []) {
      const block = document.createElement('div');
      block.className = 'ai-card-doc';
      const title = document.createElement('strong');
      title.textContent = doc.title || '';
      const excerpt = document.createElement('p');
      excerpt.textContent = doc.excerpt || '';
      block.append(title, excerpt);
      if (doc.sourceLabel) {
        const source = document.createElement('p');
        source.className = 'ai-card-source';
        source.textContent = doc.sourceLabel;
        block.append(source);
      }
      wrapper.append(block);
    }
    return wrapper;
  }

  function renderFlags(flags) {
    const wrap = document.createElement('p');
    wrap.className = 'ai-flags';
    const label = document.createElement('strong');
    label.textContent = `${text('chat.flagsTitle')} `;
    wrap.append(label);
    const names = flags.map(flag => text(`chat.flags.${flag}`) || flag);
    const span = document.createElement('span');
    span.textContent = names.join(' · ');
    wrap.append(span);
    return wrap;
  }

  function renderSources(sources) {
    const section = document.createElement('section');
    section.className = 'ai-sources';
    const heading = document.createElement('h4');
    heading.textContent = text('answer.sourcesHeader');
    section.append(heading);
    const list = document.createElement('ul');
    for (const source of sources) {
      const item = document.createElement('li');
      const label = source.label || source.nameEn || source.nameAr || '';
      if (source.url) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'ai-source-link';
        link.textContent = `${label} ↗`;
        link.addEventListener('click', () => openExternal(source.url));
        item.append(link);
      } else {
        item.append(document.createTextNode(label));
      }
      if (source.date) {
        const date = document.createElement('span');
        date.className = 'ai-source-date';
        date.textContent = ` — ${source.date}`;
        item.append(date);
      }
      list.append(item);
    }
    section.append(list);
    return section;
  }

  /* Reading the recognised international sources for a subject the on-device data
     cannot cover. The links open in the reader's browser; nothing is fetched here. */
  function renderLinks(links, title) {
    const section = document.createElement('section');
    section.className = 'ai-sources ai-reference';
    const heading = document.createElement('h4');
    heading.textContent = title || text('noData.readAlso');
    section.append(heading);
    const list = document.createElement('ul');
    for (const link of links) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-source-link';
      button.textContent = `${(language === 'ar' ? link.nameAr : link.nameEn) || link.label} · ${link.title} ↗`;
      button.addEventListener('click', () => openExternal(link.url));
      item.append(button);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function openExternal(url) {
    if (app() && typeof app().openExternal === 'function') app().openExternal(url);
    else if (global.DawayaNative && typeof global.DawayaNative.openInAppBrowser === 'function')
      global.DawayaNative.openInAppBrowser(url, document.documentElement.lang || 'en');
    else if (global.DawayaNative && typeof global.DawayaNative.openWebPage === 'function') global.DawayaNative.openWebPage(url);
  }

  async function copyText(value) {
    try {
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /* ---------- asking with a photograph ---------- */

  /* The picture never leaves the device. It is shrunk here, read here - barcode first,
     then the printed text - and only what the read matched against the medicine directory
     on this phone goes to the model as reference data. */
  let photo = null;

  function attachSupported() {
    return Boolean(dom && dom.photoInput && global.DawayaAIPhoto);
  }

  /* Only offer the control where something can actually read the picture: a tap that
     opens a picker and then says "this device cannot read photos" is worse than no button. */
  function renderAttach() {
    if (!dom || !dom.attach) return;
    const canRead = attachSupported() && global.DawayaAIPhoto.canRead();
    if (!canRead) {
      dom.attach.hidden = true;
      return;
    }
    if (!photo) dom.attach.hidden = false;
    dom.attach.textContent = text('photo.attach');
    dom.attach.setAttribute('aria-label', text('photo.attachAria'));
    if (dom.attachRemove) {
      dom.attachRemove.textContent = text('photo.remove');
      dom.attachRemove.setAttribute('aria-label', text('photo.removeAria'));
    }
  }

  function openPhotoPicker() {
    if (asking || !attachSupported()) return;
    const native = global.DawayaNative;
    if (native && typeof native.pickPhoto === 'function') {
      Promise.resolve().then(() => native.pickPhoto({ language })).then(picked => {
        if (!picked || picked.cancelled) return;
        if (picked.error) { showAttachState(text('photo.permission')); return; }
        takePhoto(dataUrlToFile(picked.dataUrl || picked.image, picked.fileName));
      }).catch(() => showAttachState(text('photo.failed')));
      return;
    }
    dom.photoInput.click();
  }

  function dataUrlToFile(value, name) {
    const raw = String(value || '');
    const comma = raw.indexOf(',');
    if (comma < 0) return null;
    const head = raw.slice(0, comma);
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    let binary;
    try {
      binary = atob(raw.slice(comma + 1));
    } catch (_) {
      return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], String(name || 'photo.jpg'), { type: mime });
  }

  function takePhoto(file) {
    if (!file) return;
    if (!/^image\//.test(String(file.type || '')) && !/\.(jpe?g|png|heic|webp|gif|bmp)$/i.test(String(file.name || ''))) {
      showAttachState(text('photo.notImage'));
      return;
    }
    clearPhoto({ silent: true });
    photo = { file, url: '', read: null, state: 'ready' };
    try {
      photo.url = URL.createObjectURL(file);
    } catch (_) {
      photo.url = '';
    }
    if (dom.attachThumb && photo.url) {
      dom.attachThumb.src = photo.url;
      dom.attachThumb.hidden = false;
    } else if (dom.attachThumb) {
      dom.attachThumb.hidden = true;
    }
    if (dom.attachPreview) dom.attachPreview.hidden = false;
    showAttachState(text('photo.ready'));
    if (dom.attach) dom.attach.hidden = true;
  }

  function clearPhoto(options) {
    const settings = options || {};
    if (photo && photo.url) {
      try { URL.revokeObjectURL(photo.url); } catch (_) { /* the page owns nothing else */ }
    }
    photo = null;
    if (dom.attachThumb) { dom.attachThumb.removeAttribute('src'); dom.attachThumb.hidden = false; }
    if (dom.attachPreview) dom.attachPreview.hidden = true;
    if (dom.attachState) { dom.attachState.textContent = ''; dom.attachState.dataset.state = ''; }
    renderAttach();
    if (dom.photoInput) dom.photoInput.value = '';
    if (!settings.silent) dom.input.focus();
  }

  function showAttachState(message) {
    if (!dom.attachState) return;
    dom.attachState.textContent = String(message || '');
    dom.attachState.dataset.state = photo ? photo.state : '';
  }

  /* Read the picture before the question goes anywhere, so the route is known by then. */
  async function readPhoto() {
    if (!photo || !photo.file) return null;
    if (photo.read) return photo.read;
    photo.state = 'reading';
    showAttachState(text('photo.reading'));
    let read = null;
    try {
      read = await global.DawayaAIPhoto.ask(photo.file);
    } catch (error) {
      read = null;
    }
    if (!read) {
      photo.state = 'failed';
      photo.read = null;
      showAttachState(text('photo.failed'));
      return null;
    }
    photo.read = read;
    photo.state = read.route === 'barcode' || read.route === 'ocr' ? 'read' : 'unread';
    showAttachState(attachRouteLine(read));
    return read;
  }

  /* The reader is told which route was taken and why, in the same words the answer carries. */
  function attachRouteLine(read) {
    if (!read) return text('photo.failed');
    if (read.route === 'barcode') return text('photo.barcode', { code: read.code, name: read.name });
    if (read.route === 'ocr') return text('photo.text', { name: read.name });
    if (read.route === 'unreadable') return text(read.text ? 'photo.noMatch' : 'photo.nothing');
    return text('photo.unsupported');
  }

  /* ---------- asking ---------- */

  async function submit() {
    if (!dom || asking) return;
    const raw = dom.input.value.trim();
    /* A photograph of a pack is a question on its own; the reader does not have to type. */
    if (!raw && !photo) return;
    dom.input.value = '';
    autoGrow();
    await ask(raw);
  }

  async function ask(raw) {
    if (asking) return;
    const assistant = global.DawayaAIAssistant;
    if (!assistant || !assistant.assets) {
      await boot();
      if (!assistant || !assistant.assets) return;
    }
    const polish = privacy();
    const redacted = polish && typeof polish.redact === 'function'
      ? polish.redact(String(raw).slice(0, MAX_QUESTION), language)
      : { text: String(raw).slice(0, MAX_QUESTION), found: [] };
    const question = String(redacted.text || '').trim();
    const attached = await readPhoto();
    if (!question && !attached) return;
    if (redacted.found && redacted.found.length) dom.input.setAttribute('data-redacted', 'true');

    /* One control in the composer, not two: the send button leaves the slot and
       stop takes its place for the length of the generation. */
    asking = true;
    dom.send.hidden = true;
    dom.stop.hidden = false;
    if (dom.attach) dom.attach.disabled = true;
    dom.status.dataset.state = 'generating';
    renderStatus();

    /* A photo with no typed line still has to read as something in the log. */
    const readName = attached && attached.name ? String(attached.name) : '';
    const shown = question ? question
      : readName ? `${text('photo.about')} ${readName}`
        : text('photo.questionLabel');
    storeTurn('user', { text: shown });
    addUser(shown, true);
    const turn = { role: 'assistant', text: '', result: null };
    storeTurn('assistant', turn);
    addBot(turn, true);
    pending = turn;
    paintPending();

    let result;
    /* The turns above this one go to the model so "and its dose?" still means the medicine
       the reader just asked about. The current pair is not in yet: the user line was stored
       first and the empty assistant placeholder last. */
    const priorTurns = turns.slice(0, Math.max(0, turns.length - 2))
      .filter(entry => entry && (entry.role === 'user' || entry.role === 'assistant') && String(entry.text || '').trim())
      .map(entry => ({ role: entry.role, text: String(entry.text).slice(0, 700) }));
    try {
      result = await assistant.ask(question, {
        onToken: token => {
          turn.text += String(token || '');
          if (turn.bubble) paintText(turn.bubble, turn.text);
          scrollSoon();
        },
        photo: attached || null
      }, priorTurns);
    } catch (error) {
      result = {
        type: 'refusal',
        text: text('errors.generic'),
        sources: [],
        sourcesAddedByCode: true,
        disclaimer: disclaimer()
      };
    }

    pending = null;
    asking = false;
    dom.send.hidden = false;
    dom.stop.hidden = true;
    if (dom.attach) dom.attach.disabled = false;
    turn.result = result;
    turn.text = String(result.text || turn.text || '');
    paintResult(turn);
    lastResult = result;
    persistTurn(shown, turn);
    /* The picture has done its job: it is dropped here rather than kept in memory or
       written to the stored conversation, which holds text only. */
    if (photo) clearPhoto({ silent: true });
    renderStatus();
    renderModel();
    scrollSoon();
    dom.input.focus({ preventScroll: true });
  }

  function paintPending() {
    if (!pending || !pending.bubble) return;
    pending.bubble.textContent = '';
    if (!pending.text) {
      const typing = document.createElement('p');
      typing.className = 'ai-typing';
      typing.textContent = text('ui.typing');
      pending.bubble.append(typing);
    }
    if (pending.text) {
      const live = document.createElement('div');
      live.className = 'ai-text';
      live.dataset.streaming = 'true';
      live.textContent = pending.text;
      pending.bubble.append(live);
    }
  }

  async function stopGeneration() {
    if (!asking) return;
    try {
      await global.DawayaAIAssistant.stop();
    } catch (_) {}
  }

  function persistTurn(question, turn) {
    const history = privacy();
    if (!history || typeof history.record !== 'function') return;
    history.record('user', question).catch(() => {});
    const body = String(turn.text || '').slice(0, 4000);
    if (body) history.record('assistant', body, resultMeta(turn.result)).catch(() => {});
  }

  /* What a stored answer needs to be shown again as it was: the type, the
     sources, the disclaimer and the emergency card. The card and the flags are
     rebuilt only while the answer is live; the text is always kept. */
  function resultMeta(result) {
    if (!result || !result.type) return null;
    return {
      type: result.type,
      title: result.title || '',
      ambulance: result.ambulance || '',
      pillars: Array.isArray(result.pillars) ? result.pillars.slice(0, 6) : null,
      sources: Array.isArray(result.sources) ? result.sources.slice(0, 8) : null,
      sourcesAddedByCode: Boolean(result.sourcesAddedByCode),
      disclaimer: result.disclaimer || '',
      /* A general answer has to come back flagged as general after a reload, or a stored reply
         the database never grounded would read like one it did. */
      label: result.label || '',
      note: result.note || '',
      guard: result.guard && Array.isArray(result.guard.reasons)
        ? { reasons: result.guard.reasons.slice(0, 4) }
        : null
    };
  }

  function restoreTurn(item) {
    const role = item.role === 'user' ? 'user' : 'assistant';
    const body = String(item.text || '');
    if (role === 'user') return { role, text: body };
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : null;
    return { role, text: body, result: meta ? { ...meta, text: body } : null };
  }

  /* The log is not a scroller of its own: on a phone the body scrolls, on a desktop the
     document does. Whichever one actually moves is the one that has to follow the answer. */
  function scroller() {
    const candidates = [document.scrollingElement, document.documentElement, document.body];
    for (const node of candidates) {
      if (node && node.scrollHeight > node.clientHeight + 4) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollSoon(options) {
    const force = Boolean(options && options.force);
    global.requestAnimationFrame(() => {
      if (!dom || !dom.log) return;
      const node = scroller();
      if (!node) return;
      /* A reader who scrolled up to re-read an earlier line is left where they put
         themselves; a new turn still brings the newest line back into view. */
      if (!force && node.scrollHeight - node.scrollTop - node.clientHeight > 200) return;
      node.scrollTop = node.scrollHeight;
      dom.log.scrollTop = dom.log.scrollHeight;
    });
  }

  function autoGrow() {
    if (!dom) return;
    dom.input.style.height = 'auto';
    dom.input.style.height = `${Math.min(150, dom.input.scrollHeight)}px`;
  }

  /* ---------- download ---------- */

  function isOffline() {
    const net = global.DawayaNet;
    if (net && typeof net.isOffline === 'function') return net.isOffline();
    return global.DawayaCore && global.DawayaCore.storage
      ? global.DawayaCore.storage.get('drugcopeia-ai-offline-mode', 'on') !== 'off'
      : true;
  }

  function downloadRequiresOnline() {
    return isOffline();
  }

  async function startDownload(cellular) {
    if (downloadRequiresOnline()) {
      dom.offlineNote.hidden = false;
      dom.start.disabled = true;
      return;
    }
    const result = await model().startDownload({ cellular: Boolean(cellular) });
    if (!result || !result.ok) {
      dom.errorNote.hidden = false;
      dom.errorNote.textContent = text('download.failedNetwork');
    }
    renderModel();
  }

  async function importModel() {
    const result = await model().importFromDevice();
    if (!result || !result.ok) {
      dom.errorNote.hidden = false;
      dom.errorNote.textContent = text('download.importFailed', {
        fileName: fileName(),
        size: bytes(modelSize())
      });
    }
    renderModel();
  }

  async function removeModel() {
    if (deleteArmed && Date.now() - deleteArmed < 6000) {
      deleteArmed = 0;
      await model().removeModel();
      dom.deleteModel.textContent = text('chat.deleteModel');
      dom.cachedNote.textContent = text('chat.deleteModelDone');
      renderModel();
      return;
    }
    deleteArmed = Date.now();
    dom.deleteModel.textContent = text('chat.deleteModelConfirm');
    global.setTimeout(() => {
      if (deleteArmed) {
        deleteArmed = 0;
        if (dom) dom.deleteModel.textContent = text('chat.deleteModel');
      }
    }, 6000);
  }

  function openPrivacy() {
    if (typeof global.switchPage === 'function') global.switchPage('privacy');
    else {
      const nav = document.querySelector('[data-app-nav="privacy"]');
      if (nav) nav.click();
    }
  }

  /* ---------- the assistant's own menu ----------

     Every conversation the reader saved, plus the settings that belong to the
     assistant rather than to the app, live behind one button in its header. The
     panel opens as the same side drawer the app uses, so the two menus behave
     alike: backdrop, locked page, focus held inside, Escape and an outside tap
     close it. */

  let menuReturnFocus = null;
  let menuPreviousOverflow = '';

  function openMenu() {
    if (!dom.menuBackdrop || !dom.menuBackdrop.hidden) return;
    menuReturnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    menuPreviousOverflow = document.body.style.overflow;
    dom.menuBackdrop.hidden = false;
    dom.menu.hidden = false;
    document.body.style.overflow = 'hidden';
    dom.menuButton.setAttribute('aria-expanded', 'true');
    dom.menuButton.classList.add('is-open');
    renderMenuSettings();
    renderMenuSessions();
    dom.menuClose.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!dom.menuBackdrop || dom.menuBackdrop.hidden) return;
    dom.menuBackdrop.hidden = true;
    dom.menu.hidden = true;
    document.body.style.overflow = menuPreviousOverflow;
    dom.menuButton.setAttribute('aria-expanded', 'false');
    dom.menuButton.classList.remove('is-open');
    setMenuSettings(false);
    const preferred = menuReturnFocus;
    menuReturnFocus = null;
    if (preferred && preferred.isConnected && preferred.getClientRects().length) preferred.focus({ preventScroll: true });
    else dom.menuButton.focus({ preventScroll: true });
  }

  function trapMenuFocus(event) {
    if (event.key !== 'Tab' || !dom.menu || dom.menu.hidden) return;
    /* The rows carry inline <svg><use href> icons, and [href] would match those too.
       Only HTML controls can take focus, so the wrap has to count only those. */
    const items = [...dom.menu.querySelectorAll('button,[href],input,select,textarea,[tabindex]')]
      .filter(node => node.namespaceURI === 'http://www.w3.org/1999/xhtml' && !node.disabled && node.getClientRects().length);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* Assistant settings are behind one button at the bottom of the menu, so the
     everyday list stays short. */
  function setMenuSettings(open) {
    if (!dom || !dom.menuSettingsPanel) return;
    dom.menuSettingsPanel.hidden = !open;
    dom.menuSettingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleMenuSettings() {
    setMenuSettings(dom.menuSettingsPanel.hidden);
  }

  function sessionStamp(value) {
    const date = new Date(Number(value) || Date.now());
    try {
      return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  async function renderMenuSessions() {
    if (!dom || dom.menu.hidden) return;
    const history = privacy();
    dom.menuSessions.textContent = '';
    const sessions = history && typeof history.listSessions === 'function'
      ? await history.listSessions().catch(() => [])
      : [];
    if (!sessions.length) {
      dom.menuSessionsEmpty.hidden = false;
      dom.menuSessionsEmpty.textContent = text('menu.noConversations');
      return;
    }
    dom.menuSessionsEmpty.hidden = true;
    for (const session of sessions.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'ai-menu-session';
      row.setAttribute('role', 'listitem');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'ai-menu-session-open';
      const title = document.createElement('span');
      title.className = 'ai-menu-session-title';
      title.textContent = session.title || text('menu.conversation');
      const meta = document.createElement('span');
      meta.className = 'ai-menu-session-meta';
      meta.textContent = `${sessionStamp(session.updatedAt)} · ${session.messages}`;
      open.append(title, meta);
      open.addEventListener('click', async () => {
        const opened = await openSession(session.id);
        if (opened) closeMenu();
        renderMenuSessions();
      });
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'ai-menu-session-delete';
      drop.setAttribute('aria-label', text('menu.deleteConversation'));
      drop.title = text('menu.deleteConversation');
      drop.textContent = '×';
      drop.addEventListener('click', async () => {
        if (history && typeof history.deleteSession === 'function') {
          const gone = await history.deleteSession(session.id).catch(() => null);
          if (gone && gone.wasCurrent) { turns = []; if (dom) dom.log.textContent = ''; }
        }
        renderMenuSessions();
        renderHistory();
      });
      row.append(open, drop);
      dom.menuSessions.append(row);
    }
  }

  function renderMenuSettings() {
    if (!dom) return;
    const on = historyOn();
    dom.menuHistoryToggle.checked = on;
    dom.menuHistoryLabel.textContent = on ? text('chat.historyOn') : text('chat.historyOff');
    dom.menuModelLine.textContent = text('menu.modelLine', {
      name: modelName(),
      size: bytes(modelSize()),
      state: text(`state.${stateKey()}`)
    });
    const device = model().device || {};
    dom.menuLeanLine.hidden = !device.ramMb;
    if (device.ramMb) {
      dom.menuLeanLine.textContent = text('menu.memoryLine', {
        ram: `${(device.ramMb / 1024).toFixed(1)} GB`,
        mode: usesLeanProfile() ? text('menu.leanMode') : text('menu.fullMode')
      });
    }
    dom.menuModel.textContent = text('menu.modelButton');
  }

  function modelName() {
    const assistant = global.DawayaAIAssistant;
    const modelEntry = assistant && assistant.assets && assistant.assets.modelConfig.model;
    return (modelEntry && modelEntry.id) || 'model';
  }

  function usesLeanProfile() {
    const device = model().device || {};
    const limits = (global.DawayaAIAssistant && global.DawayaAIAssistant.assets && global.DawayaAIAssistant.assets.modelConfig.device) || {};
    const recommended = Number(limits.recommendedRamMB || 0);
    return Boolean(recommended && device.ramMb && Number(device.ramMb) < recommended);
  }

  /* ---------- history ---------- */

  function historyOn() {
    const history = privacy();
    return Boolean(history && typeof history.historyEnabled === 'function' && history.historyEnabled());
  }

  /* The menu's one-line feedback slot: what just happened to the conversation. */
  let noteStamp = 0;
  function menuNote(message) {
    if (!dom || !dom.menuNote) return;
    const stamp = ++noteStamp;
    dom.menuNote.hidden = !message;
    dom.menuNote.textContent = message || '';
    if (message) global.setTimeout(() => { if (stamp === noteStamp) menuNote(''); }, 2600);
  }

  function renderHistory() {
    if (!dom) return;
    const on = historyOn();
    dom.menuHistoryToggle.checked = on;
    dom.menuHistoryLabel.textContent = on ? text('chat.historyOn') : text('chat.historyOff');
  }

  async function toggleHistory() {
    const history = privacy();
    if (!history) return;
    const on = history.setHistoryEnabled(dom.menuHistoryToggle.checked);
    renderHistory();
    if (on) {
      for (const turn of turns) {
        if (turn.role === 'user' || (turn.role === 'assistant' && turn.text)) {
          await history.record(turn.role, String(turn.text || '')).catch(() => {});
        }
      }
      menuNote(text('chat.historySaved'));
    } else {
      await history.clearHistory().catch(() => {});
      renderMenuSessions();
    }
  }

  /* "New chat" starts an empty conversation and keeps the saved ones. The old
     conversation is already on disk; it is not erased by starting another. */
  async function newChat() {
    if (asking) stopGeneration();
    turns = [];
    pending = null;
    lastResult = null;
    if (dom) dom.log.textContent = '';
    const history = privacy();
    if (history && typeof history.beginNewSession === 'function') {
      await history.beginNewSession().catch(() => {});
    } else if (history && typeof history.clearHistory === 'function') {
      await history.clearHistory().catch(() => {});
    }
    if (dom) {
      menuNote(text('chat.newChatDone'));
    }
  }

  /* Opening a conversation from the Privacy list or the assistant menu. */
  async function openSession(id) {
    const history = privacy();
    if (!history || typeof history.loadSession !== 'function') return false;
    if (asking) stopGeneration();
    const stored = await history.loadSession(id).catch(() => null);
    if (!stored) return false;
    turns = stored.map(restoreTurn);
    pending = null;
    if (dom) {
      dom.log.textContent = '';
      renderTurns();
      menuNote(text('chat.openedConversation'));
    }
    return true;
  }

  /* Called after the reader changes saving or deletes a conversation on the
     Privacy page, so this screen never shows a conversation that is gone. */
  async function afterHistoryChange() {
    if (!dom) return;
    renderHistory();
    const history = privacy();
    if (!history) return;
    if (!historyOn()) {
      turns = [];
      pending = null;
      dom.log.textContent = '';
      return;
    }
    const stored = await history.load().catch(() => []);
    turns = (stored || []).map(restoreTurn);
    dom.log.textContent = '';
    renderTurns();
  }

  function renderFatal() {
    if (!dom || !dom.log) return;
    dom.log.textContent = '';
    const note = document.createElement('p');
    note.className = 'ai-inline-note ai-error-note';
    note.textContent = text('errors.configMissing');
    dom.log.append(note);
  }

  /* ---------- opening the page ---------- */

  async function open() {
    opened = true;
    await boot();
    if (!dom) return;
    if (dom.menu && !dom.menu.hidden) closeMenu();
    renderHistory();
    renderModel();
    if (historyOn()) {
      const history = privacy();
      if (history && typeof history.load === 'function') {
        const stored = await history.load().catch(() => []);
        if (stored && stored.length && !turns.length) {
          turns = stored.map(restoreTurn);
          renderTurns();
        }
      }
    }
    ensureIndexed().then(() => scrollSoon());
    dom.input.focus({ preventScroll: true });
  }

  async function wipe() {
    turns = [];
    pending = null;
    const history = privacy();
    if (history && typeof history.clearHistory === 'function') await history.clearHistory().catch(() => {});
    try {
      await model().removeModel();
    } catch (_) {}
    if (dom) {
      dom.log.textContent = '';
      renderHistory();
      renderModel();
    }
  }

  global.DawayaAIChat = {
    open,
    ask,
    applyLanguage,
    wipe,
    openSession,
    afterHistoryChange,
    boot,
    get ready() {
      return Boolean(initializing);
    },
    get asking() {
      return asking;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
