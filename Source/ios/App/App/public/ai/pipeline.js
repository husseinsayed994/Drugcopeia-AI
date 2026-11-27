/*
 * Dawaya AI - the question pipeline.
 *
 * Every question runs through seven steps in this exact order:
 *   1 sanitize, 2 topic gate, 3 emergency, 4 retrieval, 5 generation, 6 output guard,
 *   7 sources plus disclaimer.
 * The model is only reachable after steps 1 to 4 have all passed. Step 4 has two outcomes: the
 * app data answers it, and then generation is grounded in that data and checked against it; or
 * nothing on the device answers it, and step 5 answers as clearly labelled general knowledge
 * under a guard that discards any dose nobody verified - a health question the medicine database
 * does not cover is still a health question. Steps 6 and 7 are code: the disclaimer and the
 * source list are assembled here and are never produced by the model.
 *
 * Exposed as DawayaAIAssistant.
 */
(function (global) {
  'use strict';

  const T = () => global.DawayaAIText;
  const ASSET_BASE = 'assets/ai/';
  const PROMPT_FILES = { ar: 'system-ar.txt', en: 'system-en.txt', generalAr: 'general-ar.txt', generalEn: 'general-en.txt', classifier: 'classifier.txt', chatAr: 'chat-ar.txt', chatEn: 'chat-en.txt' };

  let context = null;
  let clarifyUsed = false;
  let activeRequestId = null;

  function configure(next) {
    context = {
      policy: next.policy,
      messages: next.messages || {},
      prompts: next.prompts || {},
      retrieval: next.retrieval || global.DawayaAIRetrieval,
      safety: next.safety || global.DawayaAISafety,
      model: next.model || global.DawayaAIModel,
      runtime: next.runtime || global.DawayaAIRuntime,
      language: next.language || 'ar',
      storage: next.storage || (global.DawayaCore && global.DawayaCore.storage) || null,
      onStage: next.onStage || null,
      now: next.now || (() => Date.now())
    };
    clarifyUsed = false;
    return api;
  }

  /* ---------- assets: config, prompts and fixed messages live in files ---------- */

  async function loadAssets(base) {
    const root = base || ASSET_BASE;
    /* Config files do not carry a ?v= query, so ask for revalidation first; when the device is
       offline (or the app has no network at all) the cached copy from the shell cache answers. */
    const read = path => fetch(path, { cache: 'no-cache' })
      .catch(() => fetch(path, { cache: 'force-cache' }))
      .then(response => (response.ok ? response : Promise.reject(new Error(`${path}: ${response.status}`))));
    const readJson = path => read(path).then(response => response.json());
    const readText = path => read(path).then(response => response.text());
    const [modelConfig, policy, messagesAr, messagesEn, systemAr, systemEn, generalAr, generalEn, classifier, chatAr, chatEn] = await Promise.all([
      readJson(`${root}model-config.json`),
      readJson(`${root}policy-config.json`),
      readJson(`${root}messages-ar.json`),
      readJson(`${root}messages-en.json`),
      readText(`${root}prompts/${PROMPT_FILES.ar}`),
      readText(`${root}prompts/${PROMPT_FILES.en}`),
      readText(`${root}prompts/${PROMPT_FILES.generalAr}`),
      readText(`${root}prompts/${PROMPT_FILES.generalEn}`),
      readText(`${root}prompts/${PROMPT_FILES.classifier}`),
      readText(`${root}prompts/${PROMPT_FILES.chatAr}`),
      readText(`${root}prompts/${PROMPT_FILES.chatEn}`)
    ]);
    const loaded = {
      modelConfig,
      policy,
      messages: { ar: messagesAr, en: messagesEn },
      prompts: { ar: systemAr, en: systemEn, general: { ar: generalAr, en: generalEn }, classifier, chat: { ar: chatAr, en: chatEn } }
    };
    api.assets = loaded;
    return loaded;
  }

  function useAssets(loaded) {
    api.assets = loaded;
    return loaded;
  }

  /* ---------- fixed messages ---------- */

  function bundle() {
    const language = context && context.language === 'en' ? 'en' : 'ar';
    const messages = (api.assets && api.assets.messages) || {};
    return messages[language] || messages.ar || {};
  }

  /* A greeting is answered in the language it was said in, so a reader who writes "hello"
     in an Arabic interface is not greeted back in Arabic they did not choose. */
  function bundleFor(language) {
    if (!language || language === (context && context.language)) return bundle();
    const messages = (api.assets && api.assets.messages) || {};
    return messages[language === 'en' ? 'en' : 'ar'] || messages.ar || {};
  }

  function lookup(node, path) {
    const parts = String(path).split('.');
    let value = node;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) value = value[part];
      else return null;
    }
    return value;
  }

  function message(path, vars) {
    return render(bundle(), path, vars, path);
  }

  function messageIn(language, path, vars) {
    return render(bundleFor(language), path, vars, path);
  }

  function render(node, path, vars, missing) {
    const value = lookup(node, path);
    if (value === null) return String(missing);
    if (Array.isArray(value)) return value.map(line => fill(line, vars));
    return fill(String(value), vars);
  }

  function fill(template, vars) {
    let out = String(template || '');
    for (const [key, value] of Object.entries(vars || {})) out = out.split(`{${key}}`).join(String(value));
    return out;
  }

  function bytesLabel(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} جيجابايت`;
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} ميجابايت`;
    return `${Math.round(bytes / 1024)} كيلوبايت`;
  }

  function stage(name, detail) {
    if (context && typeof context.onStage === 'function') {
      try {
        context.onStage({ name, detail: detail || null });
      } catch (_) {}
    }
    return null;
  }

  /* ---------- the seven steps ---------- */

  function modelUsable() {
    const STATES = global.DawayaAIModel ? global.DawayaAIModel.STATES : {};
    return Boolean(context.runtime.available()
      && context.model
      && (context.model.state === STATES.READY || context.model.state === STATES.LOADING || context.model.state === STATES.READY_TO_LOAD));
  }

  /* The script the reader typed in decides the language of the answer. An English question
     used to be pushed through the Arabic prompt and then rejected by the Arabic-only output
     guard, so the reader either saw Arabic they did not ask for or a bare database card. */
  function answerLanguage(question, fallback) {
    const ratio = T().arabicRatio(String(question || ''));
    if (ratio >= 0.3) return 'ar';
    if (ratio <= 0.02) return 'en';
    return fallback === 'en' ? 'en' : 'ar';
  }

  /* The last few turns, so "وجرعته؟" means the medicine the reader just asked about. */
  function historyBlock(history) {
    const limits = (context.policy && context.policy.limits) || {};
    const maxTurns = Number(limits.maxHistoryTurns || 6);
    let maxChars = Number(limits.maxHistoryChars || 1200);
    /* A phone on the memory-saving profile only has a 1024-token window, and the system
       rules plus the retrieved records already fill most of it. History is what is left
       over there, so it is cut before it pushes the records out of the prompt. */
    const params = context.model && typeof context.model.generationParams === 'function' ? context.model.generationParams() : {};
    if (Number(params.n_ctx || 0) > 0 && Number(params.n_ctx) <= 1200) maxChars = Math.min(maxChars, 320);
    const turns = (Array.isArray(history) ? history : [])
      .filter(turn => turn && (turn.role === 'user' || turn.role === 'assistant') && String(turn.text || '').trim())
      .slice(-maxTurns)
      .map(turn => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${String(turn.text).replace(/\s+/g, ' ').trim()}`);
    while (turns.join('\n').length > maxChars && turns.length > 1) turns.shift();
    if (!turns.length) return '';
    return 'Recent conversation, context for a follow-up only - do not repeat it:\n'
      + turns.map(line => T().truncate(line, Math.max(20, Math.floor(maxChars / 2)))).join('\n');
  }

  function fixedChatAnswer(kind, language, result, mark, note, timings, reason) {
    mark('chat');
    note('chat:fixed', reason || kind);
    const path = `conversation.${kind}`;
    const text = messageIn(language, path);
    return {
      type: 'chat',
      kind,
      text: text === path ? messageIn(language, 'conversation.greeting') : text,
      sources: [],
      modelCalled: false,
      stages: result.stages,
      timings
    };
  }

  /* A greeting gets a greeting back, not a refusal and not a disclaimer. */
  async function chatAnswer(question, kind, language, history, result, mark, note, timings, local) {
    const chatPrompt = api.assets && api.assets.prompts.chat ? api.assets.prompts.chat[language] : '';
    if (!modelUsable() || !chatPrompt) return fixedChatAnswer(kind, language, result, mark, note, timings, modelUsable() ? 'no-prompt' : 'no-model');
    const loaded = await context.model.ensureLoaded();
    mark('loadModel');
    if (!loaded.ok) return fixedChatAnswer(kind, language, result, mark, note, timings, 'load-failed');
    const params = { ...(context.model.generationParams ? context.model.generationParams() : {}) };
    params.n_predict = Math.min(Number(params.n_predict || 80), 80);
    params.temperature = Math.max(0.5, Number(params.temperature || 0.7));
    activeRequestId = `h${result.startedAt.toString(36)}`;
    const generation = await context.runtime.generate({
      requestId: activeRequestId,
      prompt: fillPlaceholders(chatPrompt, { HISTORY: history, QUESTION: question }),
      params,
      onToken: token => {
        if (typeof local.onToken === 'function') local.onToken(token);
      }
    }).catch(error => ({ error: String(error && error.message || error), text: '' }));
    mark('generate');
    activeRequestId = null;
    const answer = String((generation && generation.text) || '').trim();
    if (generation && generation.cancelled) {
      note('generate:cancelled');
      const stopped = { ...fixedChatAnswer(kind, language, result, mark, note, timings, 'cancelled'), cancelled: true };
      if (answer) stopped.text = answer;
      return stopped;
    }
    const guard = context.safety.guardChatOutput(answer, { language });
    note('chatguard', guard.ok ? 'accepted' : guard.reasons.map(reason => reason.code).join(','));
    if (!guard.ok) return { ...fixedChatAnswer(kind, language, result, mark, note, timings, 'guard'), guard };
    return {
      type: 'chat',
      kind,
      text: answer,
      sources: [],
      modelCalled: true,
      stages: result.stages,
      timings,
      metrics: generation.metrics || null
    };
  }

  /* An answer written from the model's own general knowledge, for a health question nothing on
     the device can answer. Nothing here is grounded in a record, so the guard is stricter about
     numbers rather than looser: an answer that states a dose nobody verified is discarded and the
     reader is left with the reference links. */
  async function generalAnswer(question, language, history, links, result, mark, note, timings, local) {
    const rules = context.policy.general || {};
    const prompts = api.assets && api.assets.prompts ? api.assets.prompts.general : null;
    const template = prompts ? String(prompts[language === 'en' ? 'en' : 'ar'] || '') : '';
    if (!rules.enabled || !template || !modelUsable() || !context.runtime.available()) {
      note('general:skipped', !rules.enabled ? 'policy' : !template ? 'no-prompt' : 'no-model');
      return null;
    }
    /* Pregnancy, breastfeeding, interactions, kidney or liver disease, children and dose
       questions are never answered from the model's own knowledge. */
    if (context.safety.highRiskIntent(question)) {
      note('general:blocked', 'high-risk-intent');
      return null;
    }
    const loaded = await context.model.ensureLoaded();
    mark('loadModel');
    if (!loaded.ok) {
      note('load:failed', loaded.error);
      return null;
    }
    let tokenCount = 0;
    let firstTokenAt = 0;
    const generateStartedAt = context.now();
    activeRequestId = `g${result.startedAt.toString(36)}`;
    const generation = await context.runtime.generate({
      requestId: activeRequestId,
      prompt: fillPlaceholders(template, { HISTORY: history, QUESTION: question }),
      params: context.model.generationParams(),
      onToken: token => {
        if (!firstTokenAt) firstTokenAt = context.now();
        tokenCount += 1;
        if (typeof local.onToken === 'function') local.onToken(token);
      }
    }).catch(error => ({ error: String(error && error.message || error), text: '' }));
    mark('generate');
    activeRequestId = null;

    if (generation && generation.cancelled) {
      note('general:cancelled');
      return withDisclaimer({
        type: 'general',
        mode: 'cancelled',
        text: messageIn(language, 'answer.stopped'),
        modelCalled: true,
        steps: result.stages,
        timings
      });
    }
    const answer = tidy(String((generation && generation.text) || '').trim());
    if (!generation || generation.error || !answer) {
      note('general:failed', (generation && generation.error) || 'empty');
      return null;
    }
    let guard = context.safety.guardGeneralOutput(answer, { language });
    note('generalguard', guard.ok ? 'accepted' : guard.reasons.map(reason => reason.code).join(','));
    let shownAnswer = answer;
    if (!guard.ok) {
      const kept = salvage(answer, template, sentence => context.safety.guardGeneralOutput(sentence, { language, partial: true }));
      if (!kept) return null;
      note('generalguard:salvaged', kept.dropped);
      guard = kept.guard;
      shownAnswer = kept.text;
    }

    const measuredTokens = Number(generation.tokens || 0);
    const elapsedMs = Number(generation.milliseconds || (context.now() - generateStartedAt));
    const tokenTotal = measuredTokens || tokenCount;
    return withDisclaimer({
      type: 'general',
      mode: 'general',
      text: shownAnswer,
      label: messageIn(language, 'general.label'),
      note: messageIn(language, 'general.note'),
      links,
      linksTitle: links.length ? message('noData.readAlso') : '',
      doctorNote: links.length ? messageIn(language, 'general.verify') : '',
      guard,
      modelCalled: true,
      metrics: {
        tokens: tokenTotal,
        milliseconds: elapsedMs,
        firstTokenMs: firstTokenAt ? firstTokenAt - generateStartedAt : null,
        tokensPerSecond: tokenTotal / Math.max(0.001, elapsedMs / 1000)
      },
      steps: result.stages,
      timings
    });
  }


  /*
   * A small model is usually right in most of an answer and wrong in one sentence. Rather than
   * throwing the whole reply away, each sentence is checked on its own: a sentence that carries
   * an unverified name, number, dose, diagnosis or stop-order - or that is a line copied out of
   * the instructions - is cut, and what is left is checked again as a whole by the same guard.
   * Nothing is rewritten and nothing is added; the guard still has the last word.
   */
  /* Collapse what a small model does when it loops: list numbering, repeated sentences. */
  function tidy(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || '').match(/[^.!?؟۔\n]+[.!?؟۔]*/g) || []) {
      const sentence = raw.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
      if (!sentence) continue;
      /* A small model sometimes starts talking as itself or as the medicine; that is not an answer. */
      /* Chinese, Japanese or Korean characters inside an Arabic or English answer mean the model lost the thread. */
      if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(sentence)) continue;
      if (/^(?:أنا|انا|I am|I'm|I’m)\s/i.test(sentence) || /مساعد صحي|health assistant/i.test(sentence)) continue;
      const key = T().normalize(sentence).replace(/[.!?؟۔]+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sentence);
    }
    return out.join(' ');
  }

  const SALVAGE_BAD = new Set(['fabricatedName', 'fabricatedNumber', 'fabricatedUnit', 'diagnosis', 'dose', 'stop']);

  function salvage(text, promptText, check) {
    const sentences = String(text || '').match(/[^.!?؟۔\n]+[.!?؟۔]*/g) || [];
    const template = T().normalize(String(promptText || ''));
    const kept = [];
    let dropped = 0;
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const folded = T().normalize(sentence);
      const copied = folded.length >= 20 && template.includes(folded.replace(/[.!?؟۔]+$/, '').trim());
      const bad = copied || check(sentence).reasons.some(reason => SALVAGE_BAD.has(reason.code));
      if (bad) dropped += 1;
      else kept.push(sentence);
    }
    if (!dropped || !kept.length) return null;
    const joined = kept.join(' ');
    const verdict = check(joined);
    return verdict.ok ? { text: joined, dropped, guard: verdict } : null;
  }

  /* An attached picture only counts when it read something the directory recognises. */
  function photoUsable(read) {
    return Boolean(read && (read.name || read.code) && read.route !== 'unsupported');
  }

  function withDisclaimer(payload, extraSources) {
    const sources = payload.sources && payload.sources.length ? payload.sources : (extraSources || []);
    return {
      ...payload,
      stages: payload.stages || payload.steps || [],
      sources,
      disclaimer: message('disclaimer'),
      disclaimerAddedByCode: true,
      sourcesAddedByCode: true
    };
  }

  /*
   * ask(rawQuestion, handlers, history) -> result object
   * handlers: { onToken(text), onStage({name, detail}), photo(reading of an attached picture,
   *           from ai/photo-ask.js: {route, name, code, evidence}) }
   * history: the earlier turns of this conversation, [{role:'user'|'assistant', text}]
   */
  /* In smart-search mode the card is the answer, and the action chips ask about one aspect
     of the medicine (alternatives, interactions, dose, pregnancy). Refocus the card on that
     aspect instead of showing the same full card for every question. */
  async function applyFocus(card, askedText, records, language) {
    const R = context.retrieval;
    if (!R || typeof R.intentFocus !== 'function' || !card || !Array.isArray(card.medicines)) return;
    /* A condition or test question can name one section of the official page ("أعراض الربو",
       "تشخيص السكري"): that section alone is the answer, so the page's other passages leave
       the card. When no passage of it survives, the card keeps what it has. */
    if (Array.isArray(card.documents) && card.documents.length && typeof R.intentSection === 'function') {
      const wantedSection = R.intentSection(askedText);
      if (wantedSection) {
        const matching = card.documents.filter(doc => doc.section === wantedSection);
        if (matching.length) {
          card.documents = matching;
          card.focus = card.focus || 'section';
          const sectionLabel = message(`answer.sections.${wantedSection}`);
          card.focusLabel = sectionLabel === `answer.sections.${wantedSection}` ? message('answer.docCardLabel') : sectionLabel;
        }
      }
    }
    const focus = R.intentFocus(askedText);
    if (!focus) return;
    card.focus = focus;
    if (focus === 'uses' || focus === 'effects') {
      /* One aspect of the medicine is the answer: its medical uses or its side effects,
         from the app's own notes, with the FDA label's indications alongside uses. The
         rest of the card (price, company, other notes) stays out of the reply. */
      const key = focus;
      card.focusLabel = message(focus === 'uses' ? 'answer.usesLabel' : 'answer.effectsLabel');
      let any = false;
      const monos = focus === 'uses' && typeof R.monographsFor === 'function' ? await R.monographsFor(records) : new Map();
      card.medicines = card.medicines.map(med => {
        const kept = med.notes && med.notes[key] ? { [key]: med.notes[key] } : null;
        const monoUses = focus === 'uses'
          ? (monos.get(med.id) || [])
              .map(item => ({ title: (item.names || [])[0] || '', text: item.sections && item.sections.indications, source: item.source }))
              .filter(block => block.text)
          : [];
        if (kept || monoUses.length) any = true;
        return Object.assign({}, med, { notes: kept, interactions: [], dose: null, pregnancy: null, monoPregnancy: null, monoUses });
      });
      if (!any) card.focusEmpty = message(focus === 'uses' ? 'answer.noUses' : 'answer.noEffects');
      return;
    }
    if (focus === 'alternatives') {
      const rows = typeof R.alternativesFor === 'function' ? R.alternativesFor(records, { limit: 8, language }) : null;
      card.focusLabel = message('answer.altCardLabel');
      card.focusNote = message('answer.altNote');
      if (rows && rows.length) card.medicines = rows;
      else card.focusEmpty = message('answer.noAlternatives');
      return;
    }
    if (focus === 'interactions') {
      card.focusLabel = message('answer.interCardLabel');
      let any = false;
      card.medicines = card.medicines.map(med => {
        if (med.interactions && med.interactions.length) any = true;
        return Object.assign({}, med, { notes: null, dose: null, pregnancy: null, monoPregnancy: null });
      });
      if (!any) card.focusEmpty = message('answer.noInteractions');
      return;
    }
    if (focus === 'dose' || focus === 'pregnancy') {
      const monos = typeof R.monographsFor === 'function' ? await R.monographsFor(records) : new Map();
      let any = false;
      if (focus === 'dose') {
        card.focusLabel = message('answer.doseLabel');
        card.medicines = card.medicines.map(med => {
          const dose = (monos.get(med.id) || [])
            .map(item => ({ title: (item.names || [])[0] || '', text: item.sections && item.sections.dosage, source: item.source }))
            .filter(block => block.text);
          if (dose.length) any = true;
          return Object.assign({}, med, { notes: null, interactions: [], dose });
        });
        if (!any) card.focusEmpty = message('answer.noDose');
        return;
      }
      card.focusLabel = message('answer.pregLabel');
      const preg = typeof R.pregnancyFor === 'function' ? await R.pregnancyFor(records) : new Map();
      card.medicines = card.medicines.map(med => {
        const entry = preg.get(med.id) || null;
        const monoPregnancy = (monos.get(med.id) || [])
          .map(item => ({ title: (item.names || [])[0] || '', text: item.sections && item.sections.pregnancy, source: item.source }))
          .filter(block => block.text);
        if (entry || monoPregnancy.length) any = true;
        return Object.assign({}, med, { notes: null, interactions: [], pregnancy: entry, monoPregnancy });
      });
      if (!any) card.focusEmpty = message('answer.pregNoData');
    }
  }

  async function ask(rawQuestion, handlers, history) {
    if (!context) throw new Error('DawayaAIAssistant.configure() must run before ask()');
    const started = context.now();
    const timings = {};
    const mark = name => {
      timings[name] = context.now() - started;
    };
    const local = handlers || {};
    const photo = local.photo && typeof local.photo === 'object' && photoUsable(local.photo) ? local.photo : null;
    const result = { question: String(rawQuestion == null ? '' : rawQuestion), stages: [], steps: [], startedAt: started };
    const note = (name, extra) => {
      result.stages.push(name);
      stage(name, extra);
    };

    /* step 1 - sanitize */
    let clean = context.safety.sanitize(result.question);
    /* A photograph of a pack can be the whole question. When the picture gave a medicine the
       directory knows, an empty text box still means "tell me about this one". */
    if (!clean.ok && clean.reason === 'empty' && photo && photo.name) {
      clean = { ok: true, text: photo.name, injectionDetected: false, injectionSpans: [] };
      note('photo:question', photo.route);
    }
    mark('sanitize');
    if (!clean.ok) {
      note('sanitize:rejected', clean.reason);
      return withDisclaimer({
        type: clean.reason === 'tooLong' || clean.reason === 'empty' ? 'inputRejected' : 'refusal',
        reason: clean.reason,
        text: message(clean.reason === 'tooLong' ? 'refusal.sanitizeTooLong' : clean.reason === 'empty' ? 'refusal.sanitizeEmpty' : 'refusal.sanitizeRejected', { max: (context.policy.limits.maxInputChars) }),
        steps: result.stages,
        timings
      });
    }
    if (clean.injectionDetected) note('sanitize:injection-stripped', clean.injectionSpans.length);

    /* Everything the reader reads back - a clarifying question, a refusal, a greeting - is
       written in the language the reader wrote in, not the language the menus happen to use. */
    const answerIn = answerLanguage(clean.text, context.language);

    /* A name read off the photograph belongs to the question as much as the typed words do:
       it is what the retrieval and the topic gate have to go on. */
    const askedText = photo && photo.name && clean.text.indexOf(photo.name) === -1
      ? `${clean.text} ${photo.name}`
      : clean.text;

    /* step 2 - topic gate, before any generation */
    const gate = await context.safety.gateTopic(askedText, { classify: classifierFor(askedText) });
    mark('gate');
    result.gate = { label: gate.label, confidence: Number((gate.confidence || 0).toFixed(3)), via: gate.via, signals: gate.signals };
    note(`gate:${String(gate.label).toLowerCase()}`, gate.via);

    if (gate.label === 'CLARIFY') {
      const second = clarifyUsed;
      clarifyUsed = true;
      return withDisclaimer({
        type: 'clarify',
        text: messageIn(answerIn, second ? 'refusal.clarifyAgain' : 'refusal.clarify'),
        steps: result.stages,
        timings
      });
    }
    if (gate.label === 'OFF_TOPIC') {
      return withDisclaimer({
        type: 'refusal',
        reason: 'offTopic',
        text: messageIn(answerIn, 'refusal.offTopic'),
        steps: result.stages,
        timings
      });
    }
    if (gate.label === 'CHAT') {
      return chatAnswer(clean.text, gate.conversation || 'greeting', answerIn, historyBlock(history), result, mark, note, timings, local);
    }

    /* step 3 - emergency: fixed message, generation is skipped entirely */
    const emergency = context.safety.detectEmergency(clean.text);
    if (emergency.matched || gate.label === 'EMERGENCY') {
      note('emergency', emergency.ruleIds);
      return withDisclaimer({
        type: 'emergency',
        ruleIds: emergency.matched ? emergency.ruleIds : ['classifier'],
        text: fill(message('emergency.body'), { phone: context.policy.emergency.ambulanceNumber }) + ' ' + message('emergency.noWait'),
        title: message('emergency.title'),
        pillars: message('emergency.pillars', { phone: context.policy.emergency.ambulanceNumber }),
        ambulance: context.policy.emergency.ambulanceNumber,
        modelCalled: false,
        steps: result.stages,
        timings
      });
    }

    /* step 4 - retrieval from the app database first, then the trusted documents */
    /* A question that names a condition and no medicine is answered from the trusted
       reference documents; fuzzy medicine hits ("الدماغية" reaching a similarly spelled
       brand) would otherwise push the condition passage out of the card. */
    const documentsOnly = Boolean(gate.signals && gate.signals.conditions > 0 && gate.signals.knownNames === 0);
    /* A complaint described in the reader's own words ("اسمرار تحت الابطين") names neither a
       medicine nor a condition, and the fuzzy rows it pulls in — an antacid, gallstones — are
       not an answer to it. Those questions go straight to the reference sources below instead
       of being dressed up as a card. Asking for a medicine by name keeps normal retrieval. */
    const complaintOnly = Boolean(gate.signals && gate.signals.symptomHits > 0 && !gate.signals.conditions
      && !gate.signals.knownNames && !gate.signals.healthHits);
    let retrieval = complaintOnly
      ? { found: false, records: [] }
      : context.retrieval.retrieve(askedText, { question: result.question, documentsOnly });
    /* "Why does my throat hurt in the morning" must not be answered from MORNING hair serum: when
       every word that reached a pack name is an everyday word, and no reference document matched,
       nothing was actually named, so the question goes to the general route like any other. */
    if (retrieval.found && !documentsOnly && typeof context.safety.isCommonWord === 'function'
      && retrieval.records.length && retrieval.records.every(record => record.kind !== 'document' && !record.title)) {
      const words = (String(askedText).toLowerCase().match(/[\p{L}]{4,}/gu) || []);
      const named = words.filter(word => {
        const hit = context.retrieval.entities && context.retrieval.entities.lookupName ? context.retrieval.entities.lookupName(word) : null;
        return Boolean(hit);
      });
      if (named.length && named.every(word => context.safety.isCommonWord(word) || (typeof context.safety.isStopword === 'function' && context.safety.isStopword(word)))) {
        note('retrieve:common-words-only');
        retrieval = { found: false, records: [] };
      }
    }
    mark('retrieve');
    note('retrieve', { found: retrieval.found, records: retrieval.records.length });
    if (!retrieval.found) {
      /* A health question that the app data cannot answer still deserves one, so the model
         answers from its own general knowledge, labelled as such, and the reference links stay
         under it so the reader can check. Two things stop that being a licence to invent: the
         general guard throws away any answer carrying a dose nobody verified, and when it does
         - or when no model is here - the reader gets the recognised international sources alone,
         which is what this screen did before general knowledge was allowed. */
      const links = typeof context.retrieval.referenceLinks === 'function'
        ? context.retrieval.referenceLinks(result.question || clean.text) : [];
      const general = await generalAnswer(clean.text, answerIn, historyBlock(history), links, result, mark, note, timings, local);
      if (general) return general;
      const highRisk = context.safety.highRiskIntent(clean.text);
      return withDisclaimer({
        type: 'noData',
        text: message(highRisk ? 'noData.highRiskBody' : 'noData.body'),
        title: message('noData.title'),
        hint: message('noData.tryNames'),
        links,
        linksTitle: links.length ? message('noData.readAlso') : '',
        doctorNote: links.length ? message('noData.doctorNote') : '',
        modelCalled: false,
        steps: result.stages,
        timings
      });
    }

    const pack = context.retrieval.buildContextPack(askedText, retrieval.records, answerIn);
    /* What the camera saw is reference data like any other record: the model may quote it,
       and the output guard only treats it as grounded because it is in this block. */
    if (photo && photo.evidence) pack.contextText = `${pack.contextText}\n\nFrom the attached photograph, read on this device:\n${photo.evidence}`;
    const card = context.retrieval.buildCard(retrieval.records, { language: answerIn });
    card.guardReasons = null;
    /* The owner requires every answer to carry official sources: the records above say what
       the answer was built from, and these are the government authorities the reader can
       verify it against. Code attaches both; the model never writes a link. */
    const official = typeof context.retrieval.officialLinks === 'function'
      ? context.retrieval.officialLinks(askedText, retrieval.records)
      : [];
    const officialTitle = official.length ? message('answer.verifyHeader') : '';

    /* no model on this device or build: smart search answers with the card, never a guess */
    const highRiskAsk = context.safety.highRiskIntent(askedText);
    if (!modelUsable() || !context.runtime.available() || highRiskAsk) {
      mark('smartSearch');
      note('generate:skipped', highRiskAsk ? 'high-risk-intent' : 'no-model');
      await applyFocus(card, askedText, retrieval.records, answerIn);
      return withDisclaimer({
        type: 'card',
        mode: 'smart-search',
        text: message(highRiskAsk ? 'answer.highRiskBody' : 'answer.smartSearchBody'),
        card,
        conflict: pack.conflict,
        conflictNote: pack.conflict ? message('answer.conflictNote') : '',
        links: official,
        linksTitle: officialTitle,
        modelCalled: false,
        steps: result.stages,
        timings
      }, pack.sources);
    }

    /* step 5 - grounded generation */
    const loaded = await context.model.ensureLoaded();
    mark('loadModel');
    if (!loaded.ok) {
      note('load:failed', loaded.error);
      await applyFocus(card, askedText, retrieval.records, answerIn);
      return withDisclaimer({
        type: 'card',
        mode: 'fallback',
        text: message('errors.generationFailed'),
        card,
        conflict: pack.conflict,
        conflictNote: pack.conflict ? message('answer.conflictNote') : '',
        links: official,
        linksTitle: officialTitle,
        loadError: loaded.error,
        modelCalled: false,
        steps: result.stages,
        timings
      }, pack.sources);
    }

    const prompt = buildPrompt(pack, answerIn, historyBlock(history));
    let tokenCount = 0;
    let firstTokenAt = 0;
    const generateStartedAt = context.now();
    activeRequestId = `q${started.toString(36)}`;
    const generation = await context.runtime.generate({
      requestId: activeRequestId,
      prompt,
      params: context.model.generationParams(),
      onToken: token => {
        if (!firstTokenAt) firstTokenAt = context.now();
        tokenCount += 1;
        if (typeof local.onToken === 'function') local.onToken(token);
      }
    }).catch(error => ({ error: String(error && error.message || error), text: '' }));
    mark('generate');
    activeRequestId = null;

    if (generation && generation.cancelled) {
      note('generate:cancelled');
      return withDisclaimer({
        type: 'card',
        mode: 'cancelled',
        text: message('answer.stopped'),
        card,
        links: official,
        linksTitle: officialTitle,
        modelCalled: true,
        steps: result.stages,
        timings
      }, pack.sources);
    }
    if (!generation || generation.error || !String(generation.text || '').trim()) {
      note('generate:failed', generation && generation.error);
      return withDisclaimer({
        type: 'card',
        mode: 'fallback',
        text: message('errors.generationFailed'),
        card,
        links: official,
        linksTitle: officialTitle,
        modelCalled: Boolean(generation && generation.error),
        generationError: (generation && generation.error) || 'empty',
        steps: result.stages,
        timings
      }, pack.sources);
    }

    /* step 6 - output guard */
    generation.text = tidy(generation.text);
    let guard = context.safety.guardOutput(generation.text, pack, { language: answerIn });
    mark('guard');
    note('guard', guard.ok ? 'accepted' : guard.reasons.map(reason => reason.code).join(','));
    let groundedText = String(generation.text).trim();
    if (!guard.ok) {
      const kept = salvage(generation.text, prompt, sentence => context.safety.guardOutput(sentence, pack, { language: answerIn, partial: true }));
      if (kept) {
        note('guard:salvaged', kept.dropped);
        guard = kept.guard;
        groundedText = kept.text;
      }
    }
    if (!guard.ok) {
      card.guardReasons = guard.reasons;
      return withDisclaimer({
        type: 'card',
        mode: 'guardRejected',
        text: message('guard.fallbackTitle') + ' — ' + guardReasonText(guard.reasons),
        card,
        guard,
        rawRejected: generation.text,
        links: official,
        linksTitle: officialTitle,
        modelCalled: true,
        steps: result.stages,
        timings
      }, pack.sources);
    }

    /* step 7 - sources and disclaimer, added by code */
    const measuredTokens = Number(generation.tokens || 0);
    const elapsedMs = Number(generation.milliseconds || (context.now() - generateStartedAt));
    const tokenTotal = measuredTokens || tokenCount;
    return withDisclaimer({
      type: 'answer',
      mode: 'grounded',
      text: groundedText,
      label: message('answer.generatedLabel'),
      pack: { contextChars: pack.contextText.length, records: pack.records.length },
      flags: pack.flags,
      conflict: pack.conflict,
      conflictNote: pack.conflict ? message('answer.conflictNote') : '',
      card,
      modelCalled: true,
      links: official,
      linksTitle: officialTitle,
      /* Which route the attached picture took, so the interface can say it out loud. */
      photo: photo ? { route: photo.route, name: photo.name, code: photo.code || '', readChars: String(photo.text || '').length } : null,
      metrics: {
        tokens: tokenTotal,
        milliseconds: elapsedMs,
        firstTokenMs: firstTokenAt ? firstTokenAt - generateStartedAt : null,
        tokensPerSecond: tokenTotal / Math.max(0.001, elapsedMs / 1000)
      },
      steps: result.stages,
      timings
    }, pack.sources);
  }

  function guardReasonText(reasons) {
    const codes = {
      fabricatedName: 'guard.reasonFabricated',
      fabricatedNumber: 'guard.reasonFabricated',
      fabricatedUnit: 'guard.reasonFabricated',
      diagnosis: 'guard.reasonDiagnosis',
      dose: 'guard.reasonDose',
      stop: 'guard.reasonStop',
      language: 'guard.reasonLanguage',
      offTopic: 'guard.reasonOffTopic',
      tooShort: 'guard.reasonFabricated',
      empty: 'guard.reasonFabricated'
    };
    const unique = [...new Set((reasons || []).map(reason => codes[reason.code] || 'guard.reasonFabricated'))];
    return unique.map(key => message(key)).join(' · ');
  }

  function guardReasonCodes(reasons) {
    const map = {
      fabricatedName: 'fabricated',
      fabricatedNumber: 'fabricated',
      fabricatedUnit: 'fabricated',
      diagnosis: 'diagnosis',
      dose: 'dose',
      stop: 'stop',
      language: 'language',
      offTopic: 'offTopic',
      empty: 'language',
      tooShort: 'language'
    };
    return [...new Set((reasons || []).map(reason => map[reason.code] || 'fabricated'))];
  }

  /* ---------- prompt assembly ---------- */

  function buildPrompt(pack, language, history) {
    const wanted = language === 'en' ? 'en' : 'ar';
    const fallback = wanted === 'en' ? 'ar' : 'en';
    const prompts = api.assets && api.assets.prompts ? api.assets.prompts : {};
    const template = prompts[wanted] ? prompts[wanted] : String(prompts[fallback] || '');
    const audience = typeof global.DrugcopeiaAudience === 'function' ? String(global.DrugcopeiaAudience(wanted) || '') : '';
    return (audience ? audience + '\n\n' : '') + fillPlaceholders(template, { CONTEXT: pack.contextText, QUESTION: pack.question, HISTORY: history || '' });
  }

  function fillPlaceholders(template, values) {
    let out = String(template || '');
    for (const [key, value] of Object.entries(values)) out = out.split(`{{${key}}}`).join(String(value));
    return out;
  }

  /* The classifier is only consulted for borderline questions, and only when a model is loaded. */
  function classifierFor(question) {
    if (!modelUsable()) return null;
    return () => {
      const template = api.assets && api.assets.prompts.classifier ? api.assets.prompts.classifier : '{{QUESTION}}';
      return context.runtime.generate({
        requestId: `c${Date.now().toString(36)}`,
        prompt: fillPlaceholders(template, { QUESTION: question }),
        params: context.model.classifyParams ? context.model.classifyParams() : { n_predict: 32, temperature: 0 }
      }).then(result => (result && result.text ? result.text : ''));
    };
  }

  function stop() {
    if (!activeRequestId) return Promise.resolve({ ok: false, reason: 'idle' });
    const id = activeRequestId;
    return context.runtime.cancelGeneration(id).catch(() => ({ ok: false }));
  }

  /* ---------- capability summary for the UI header ---------- */

  function capability() {
    const STATES = global.DawayaAIModel ? global.DawayaAIModel.STATES : {};
    const model = context && context.model ? context.model : null;
    const device = model ? model.device : null;
    return {
      runtime: context && context.runtime ? context.runtime.kind : 'none',
      state: model ? model.state : (STATES.NOT_DOWNLOADED || 'not-downloaded'),
      supported: Boolean(device ? device.supported : false),
      device,
      loaded: Boolean(model && model.loaded),
      smartSearchOnly: !modelUsable()
    };
  }

  const api = {
    configure,
    loadAssets,
    useAssets,
    ask,
    stop,
    capability,
    message,
    messageIn,
    fill,
    bytesLabel,
    buildPrompt,
    answerLanguage,
    historyBlock,
    fillPlaceholders,
    guardReasonText,
    guardReasonCodes,
    modelUsable,
    get clarifyUsed() {
      return clarifyUsed;
    },
    assets: null
  };
  global.DawayaAIAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
