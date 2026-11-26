/* Drugcopeia AI extras: tool cards inside the chat, clickable drug cards, saved chats
   grouped and searchable, patient/doctor modes, export and share.
   Presentation and navigation only. Answers, sources and the doctor note still come
   from the same pipeline and safety rules; nothing here writes medical text. */
(function(){
  'use strict';
  var doc=document,root=doc.documentElement;
  var lang=function(){return root.lang==='en'?'en':'ar'};
  var MODE_KEY='drugcopeia-ai-mode';
  var T={
    ar:{
      alt:'البدائل',inter:'التفاعلات',dose:'الجرعة',preg:'الحمل والرضاعة',calcDose:'حاسبة الجرعة',pair:'تفاعل مع دواء آخر',
      q:{
        alt:function(n){return 'ما هي بدائل '+n+' المتاحة وأسعارها؟'},
        inter:function(n){return 'ما أهم التفاعلات الدوائية لـ '+n+'؟'},
        dose:function(n){return 'ما الجرعة المعتادة لـ '+n+' وما الحد الأقصى؟'},
        preg:function(n){return 'هل '+n+' آمن أثناء الحمل والرضاعة؟'}
      },
      toolTitle:{inter:'فحص التفاعل بين دواءين',peds:'حاسبة جرعة الأطفال',calc:'الحاسبات الطبية'},
      toolHint:'الأداة داخل المحادثة. النتيجة مرجعية وتحتاج مراجعة الطبيب أو الصيدلي.',
      mode:'وضع الاستخدام',patient:'مريض',doctor:'طبيب',
      modeNote:{patient:'شرح مبسط بكلمات سهلة.',doctor:'لغة طبية ومعلومات أدق.'},
      saved:'محادثاتي المحفوظة',savedSearch:'ابحث في المحادثات',savedEmpty:'لا توجد محادثات محفوظة بعد.',savedNone:'لا نتائج.',
      grp:{drug:'الأدوية',cond:'الحالات المرضية',test:'التحاليل',preg:'الحمل والرضاعة',other:'أخرى'},
      msgs:'رسالة',del:'حذف',close:'إغلاق',
      exp:'تصدير ومشاركة المحادثة',expTitle:'تصدير المحادثة',share:'مشاركة',copy:'نسخ',copied:'تم النسخ',txt:'تنزيل ملف نصي',print:'طباعة / حفظ PDF',
      emptyChat:'لا توجد محادثة لتصديرها بعد.',you:'أنت',bot:'Drugcopeia',shareAns:'مشاركة',head:'محادثة Drugcopeia AI',
      foot:'للتثقيف فقط ولا تغني عن الطبيب أو الصيدلي.'
    },
    en:{
      alt:'Alternatives',inter:'Interactions',dose:'Dose',preg:'Pregnancy',calcDose:'Dose calculator',pair:'Check with another drug',
      q:{
        alt:function(n){return 'What are the available alternatives to '+n+' and their prices?'},
        inter:function(n){return 'What are the main drug interactions of '+n+'?'},
        dose:function(n){return 'What is the usual dose of '+n+' and its maximum?'},
        preg:function(n){return 'Is '+n+' safe in pregnancy and breastfeeding?'}
      },
      toolTitle:{inter:'Two-drug interaction check',peds:'Pediatric dose calculator',calc:'Clinical calculators'},
      toolHint:'This tool runs inside the chat. Results are a reference; confirm with a doctor or pharmacist.',
      mode:'Mode',patient:'Patient',doctor:'Doctor',
      modeNote:{patient:'Simple explanations in plain words.',doctor:'Clinical wording and more detail.'},
      saved:'Saved chats',savedSearch:'Search chats',savedEmpty:'No saved chats yet.',savedNone:'No results.',
      grp:{drug:'Drugs',cond:'Conditions',test:'Tests',preg:'Pregnancy',other:'Other'},
      msgs:'messages',del:'Delete',close:'Close',
      exp:'Export / share chat',expTitle:'Export chat',share:'Share',copy:'Copy',copied:'Copied',txt:'Download text file',print:'Print / save as PDF',
      emptyChat:'There is no conversation to export yet.',you:'You',bot:'Drugcopeia',shareAns:'Share',head:'Drugcopeia AI conversation',
      foot:'For education only. It does not replace your doctor or pharmacist.'
    }
  };
  var tx=function(){return T[lang()]};
  function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function log(){return doc.getElementById('aiLog')}
  function closeMenu(){var b=doc.getElementById('aiMenuClose');var bd=doc.getElementById('aiMenuBackdrop');if(bd&&!bd.hidden&&b)b.click()}
  function fill(text,send){
    var i=doc.getElementById('aiInput'),f=doc.getElementById('aiComposer');if(!i)return;
    i.value=text;i.dispatchEvent(new Event('input',{bubbles:true}));
    if(send&&f){if(f.requestSubmit)f.requestSubmit();else f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))}
    else i.focus();
  }

  /* ---------------- mode: patient / doctor ---------------- */
  function mode(){try{return localStorage.getItem(MODE_KEY)==='doctor'?'doctor':'patient'}catch(_){return 'patient'}}
  function setMode(m){
    try{localStorage.setItem(MODE_KEY,m)}catch(_){}
    root.dataset.aiMode=m;
    doc.dispatchEvent(new CustomEvent('drugcopeia-mode',{detail:m}));
  }
  root.dataset.aiMode=mode();
  /* Read by the prompt builder. A hint about wording only: the safety rules never change. */
  window.DrugcopeiaAudience=function(l){
    if(mode()==='doctor')return l==='en'
      ?'Audience: a clinician. Use precise clinical terms and give mechanism, interactions and monitoring when the context has them. Same rules as always: only facts from the context.'
      :'الجمهور: طبيب أو صيدلي. استخدم مصطلحات طبية دقيقة واذكر الآلية والتفاعلات والمتابعة إذا كانت موجودة في السياق. نفس القواعد: معلومات السياق فقط.';
    return l==='en'
      ?'Audience: a patient with no medical training. Use short sentences and plain words and explain any medical term. Same rules as always: only facts from the context.'
      :'الجمهور: مريض بلا خلفية طبية. استخدم جملاً قصيرة وكلمات بسيطة واشرح أي مصطلح طبي. نفس القواعد: معلومات السياق فقط.';
  };

  /* ---------------- tool cards inside the chat ---------------- */
  var TOOLS={inter:{page:'interactions',sel:'#interactionsPage'},peds:{page:'dose-calculator',sel:'#dosePage'},calc:{page:'calculators',sel:'#calcPage'}};
  var held={};
  function avatar(){
    var src=doc.querySelector('.ai-msg-bot .ai-avatar');
    if(src)return src.cloneNode(true);
    var a=el('span','ai-avatar','');a.innerHTML='<svg viewBox="0 0 24 24"><use href="#icon-dawaya-ai"></use></svg>';a.setAttribute('aria-hidden','true');return a;
  }
  function botShell(){
    var art=el('article','ai-msg ai-msg-bot ai-tool-msg');art.dataset.role='assistant';
    var bubble=el('div','ai-bubble');art.append(avatar(),bubble);
    return {art:art,bubble:bubble};
  }
  function openTool(key){
    var t=TOOLS[key],app=window.DawayaApp,lg=log();
    if(!t||!app||!lg)return;
    closeMenu();
    var sec=held[key]||doc.querySelector(t.sel);
    if(!sec)return;
    if(sec.dataset.mainPage){ /* first use: let the app initialise the page, then take it into the chat */
      try{app.switchPage(t.page)}catch(_){}
      sec.dataset.aiPage=sec.dataset.mainPage;sec.removeAttribute('data-main-page');
    }
    held[key]=sec;
    sec.hidden=false;sec.classList.add('ai-embedded-tool');
    var prev=sec.closest('.ai-tool-msg');if(prev)prev.remove();
    var shell=botShell();
    var h=el('strong','ai-tool-title',tx().toolTitle[key]);
    shell.bubble.append(h,sec,el('p','ai-inline-note',tx().toolHint));
    lg.append(shell.art);
    try{app.switchPage('assistant')}catch(_){}
    setTimeout(function(){shell.art.scrollIntoView({block:'start',behavior:'smooth'})},60);
  }

  /* ---------------- clickable cards: actions under each drug ---------------- */
  function decorateCards(){
    var lg=log();if(!lg)return;
    lg.querySelectorAll('.ai-card-med').forEach(function(card){
      if(card.querySelector('.ai-card-actions'))return;
      var nameEl=card.querySelector('.ai-card-name');var name=nameEl?nameEl.textContent.trim():'';
      /* Brand names in the database can end in a stray / . , - : drop the junk so the
         chip question reads the clean name. */
      name=name.replace(/[\s\/.،,-]+$/,'').trim();
      if(!name)return;
      var t=tx(),row=el('div','ai-card-actions');
      ['alt','inter','dose','preg'].forEach(function(k){
        var b=el('button','ai-chip ai-chip-small',t[k]);b.type='button';
        b.addEventListener('click',function(){fill(t.q[k](name),true)});row.append(b);
      });
      var c1=el('button','ai-chip ai-chip-small ai-chip-tool',t.calcDose);c1.type='button';c1.addEventListener('click',function(){openTool('peds')});
      var c2=el('button','ai-chip ai-chip-small ai-chip-tool',t.pair);c2.type='button';c2.addEventListener('click',function(){openTool('inter')});
      row.append(c1,c2);
      card.append(row);
    });
    lg.querySelectorAll('.ai-msg-actions').forEach(function(row){
      if(row.querySelector('.ai-share-one'))return;
      var b=el('button','ai-link-button ai-share-one',tx().shareAns);b.type='button';
      b.addEventListener('click',function(){
        var msg=row.closest('.ai-msg');
        shareText(messageText(msg),b);
      });
      row.append(b);
    });
  }

  /* ---------------- export / share ---------------- */
  function messageText(msg){
    if(!msg)return '';
    var t=tx(),who=msg.classList.contains('ai-msg-user')?t.you:t.bot,parts=[];
    var main=msg.querySelectorAll('.ai-text'),body='';
    if(main.length)main.forEach(function(n){body+=(body?'\n':'')+n.textContent.trim()});
    else{var b=msg.querySelector('.ai-bubble');body=b?b.textContent.trim():''}
    if(!body)return '';
    parts.push(who+': '+body);
    msg.querySelectorAll('.ai-card-med').forEach(function(c){
      var n=c.querySelector('.ai-card-name');
      var facts=[].map.call(c.querySelectorAll('.ai-card-facts dd, .ai-card-note, .ai-card-interaction'),function(x){return '  - '+x.textContent.trim()});
      if(n)parts.push('['+n.textContent.trim()+']\n'+facts.join('\n'));
    });
    var srcs=[].map.call(msg.querySelectorAll('.ai-sources a, .ai-links a'),function(a){return '  - '+a.textContent.trim()+(a.href?' '+a.href:'')});
    if(srcs.length)parts.push(srcs.join('\n'));
    return parts.join('\n');
  }
  function conversationText(){
    var lg=log();if(!lg)return '';
    var t=tx(),out=[t.head,new Date().toLocaleString(lang()==='ar'?'ar-EG':'en-GB'),''];
    var any=false;
    lg.querySelectorAll('.ai-msg').forEach(function(m){if(m.classList.contains('ai-tool-msg'))return;var s=messageText(m);if(s){any=true;out.push(s,'')}});
    if(!any)return '';
    out.push(t.foot);
    return out.join('\n');
  }
  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text).then(function(){return true},function(){return false});
    try{var ta=el('textarea');ta.value=text;doc.body.appendChild(ta);ta.select();var ok=doc.execCommand('copy');ta.remove();return Promise.resolve(ok)}catch(_){return Promise.resolve(false)}
  }
  function shareText(text,btn){
    if(!text)return;
    var label=btn&&btn.textContent;
    if(navigator.share){navigator.share({title:'Drugcopeia AI',text:text}).catch(function(){})}
    else copyText(text).then(function(ok){if(btn&&ok){btn.textContent=tx().copied;setTimeout(function(){btn.textContent=label},1500)}});
  }
  function download(text){
    try{
      var blob=new Blob([text],{type:'text/plain;charset=utf-8'});
      var a=el('a');a.href=URL.createObjectURL(blob);a.download='drugcopeia-ai-chat.txt';doc.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
    }catch(_){copyText(text)}
  }
  var overlay=null;
  function closeOverlay(){if(overlay){overlay.remove();overlay=null}}
  function openOverlay(title){
    closeOverlay();
    overlay=el('div','ai-overlay');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    var box=el('div','ai-overlay-box');
    var head=el('div','ai-overlay-head');head.append(el('strong','',title));
    var x=el('button','ai-overlay-x','\u00d7');x.type='button';x.setAttribute('aria-label',tx().close);x.addEventListener('click',closeOverlay);head.append(x);
    box.append(head);overlay.append(box);
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeOverlay()});
    doc.body.appendChild(overlay);
    return box;
  }
  function openExport(){
    closeMenu();
    var t=tx(),text=conversationText(),box=openOverlay(t.expTitle);
    if(!text){box.append(el('p','ai-overlay-note',t.emptyChat));return}
    var pre=el('pre','ai-export-preview',text);box.append(pre);
    var row=el('div','ai-overlay-row');
    var mk=function(label,fn){var b=el('button','ai-chip',label);b.type='button';b.addEventListener('click',function(){fn(b,label)});row.append(b);return b};
    if(navigator.share)mk(t.share,function(b){shareText(text,b)});
    mk(t.copy,function(b,l){copyText(text).then(function(ok){if(ok){b.textContent=t.copied;setTimeout(function(){b.textContent=l},1500)}})});
    mk(t.txt,function(){download(text)});
    mk(t.print,function(){
      var pr=el('div','');pr.id='ai-print-root';pr.dir='auto';pr.textContent=text;doc.body.appendChild(pr);root.classList.add('ai-printing');
      setTimeout(function(){window.print();setTimeout(function(){root.classList.remove('ai-printing');pr.remove()},600)},50);
    });
    box.append(row);
  }

  /* ---------------- saved chats: grouped and searchable ---------------- */
  var RE={
    preg:/حمل|حامل|رضاع|رضيع|ارضاع|إرضاع|pregnan|lactat|breastfe|nursing|trimester|فئة\s*[abcdx]\b/i,
    test:/تحليل|تحاليل|فحص|نسبة|hba1c|cbc|crp|esr|creatinine|كرياتينين|test\b|lab\b|level|blood count|thyroid|tsh|inr|ferritin/i,
    cond:/أعراض|مرض|ضغط|سكر|سكري|التهاب|حساسية|ربو|صداع|انفلونزا|نزلة|عدوى|علاج\s+(ال|ل)|symptom|disease|condition|diabetes|hypertension|infection|asthma|allerg|pain|fever|cough|migraine/i
  };
  function category(s){
    var u=(s.user||s.title||'');
    if(RE.preg.test(u))return 'preg';
    if(RE.test.test(u))return 'test';
    if(RE.cond.test(u))return 'cond';
    return 'drug';
  }
  function fold(s){return String(s||'').toLowerCase().replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')}
  function openSaved(){
    closeMenu();
    var t=tx(),h=window.DawayaPrivacy,box=openOverlay(t.saved);
    var q=el('input','ai-overlay-search');q.type='search';q.placeholder=t.savedSearch;q.setAttribute('aria-label',t.savedSearch);
    var list=el('div','ai-saved-list');box.append(q,list);
    var all=[];
    function paint(){
      list.textContent='';
      var needle=fold(q.value.trim()),shown=all.filter(function(s){return !needle||fold(s.text).indexOf(needle)>=0||fold(s.title).indexOf(needle)>=0});
      if(!all.length){list.append(el('p','ai-overlay-note',t.savedEmpty));return}
      if(!shown.length){list.append(el('p','ai-overlay-note',t.savedNone));return}
      ['drug','cond','test','preg','other'].forEach(function(g){
        var items=shown.filter(function(s){return s.cat===g});if(!items.length)return;
        list.append(el('p','ai-saved-group',t.grp[g]+' ('+items.length+')'));
        items.forEach(function(s){
          var row=el('div','ai-saved-row');
          var open=el('button','ai-saved-open');open.type='button';
          open.append(el('span','ai-saved-title',s.title||'...'),el('span','ai-saved-meta',new Date(s.updatedAt).toLocaleDateString(lang()==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short'})+' \u00b7 '+s.messages+' '+t.msgs));
          open.addEventListener('click',function(){
            if(window.DawayaAIChat&&window.DawayaAIChat.openSession)window.DawayaAIChat.openSession(s.id).then(function(ok){if(ok)closeOverlay()});
          });
          var del=el('button','ai-saved-del','\u00d7');del.type='button';del.setAttribute('aria-label',t.del);del.title=t.del;
          del.addEventListener('click',function(){
            h.deleteSession(s.id).then(function(r){if(r&&r.wasCurrent){var lg=log();if(lg)lg.textContent=''}all=all.filter(function(x){return x.id!==s.id});paint()});
          });
          row.append(open,del);list.append(row);
        });
      });
    }
    q.addEventListener('input',paint);
    if(h&&h.sessionIndex)h.sessionIndex().then(function(rows){
      all=(rows||[]).map(function(s){s.cat=category(s);return s});paint();
    }).catch(paint);else paint();
  }

  /* ---------------- menu entries (called by ai-shell) ---------------- */
  function modeControl(){
    var t=tx(),box=el('div','ai-mode');
    box.append(el('p','ai-nav-group',t.mode));
    var seg=el('div','ai-seg');seg.setAttribute('role','group');
    var note=el('p','ai-mode-note','');
    function paint(){
      var m=mode();
      [].forEach.call(seg.children,function(b){b.setAttribute('aria-pressed',b.dataset.m===m?'true':'false');b.classList.toggle('on',b.dataset.m===m)});
      note.textContent=t.modeNote[m];
    }
    ['patient','doctor'].forEach(function(m){
      var b=el('button','ai-seg-btn',t[m]);b.type='button';b.dataset.m=m;
      b.addEventListener('click',function(){setMode(m);paint()});seg.append(b);
    });
    box.append(seg,note);paint();return box;
  }
  window.DrugcopeiaExtras={
    openTool:openTool,openSaved:openSaved,openExport:openExport,modeControl:modeControl,mode:mode,
    labels:function(){return {saved:tx().saved,exp:tx().exp,mode:tx().mode}}
  };

  function boot(){
    var lg=log();if(!lg)return;
    new MutationObserver(decorateCards).observe(lg,{childList:true,subtree:true});
    decorateCards();
    doc.addEventListener('keydown',function(e){if(e.key==='Escape')closeOverlay()});
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot);else boot();
})();

/* Composer tools: voice and barcode, next to the photo button. They only fill the
   question; the answer, sources and doctor note come from the normal pipeline. */
(function(){
  'use strict';
  var doc=document,root=doc.documentElement;
  var ar=function(){return root.lang!=='en'};
  var L={
    ar:{mic:'بحث بالصوت',scan:'مسح باركود',scanTitle:'امسح باركود العلبة',manual:'اكتب أرقام الباركود',go:'بحث',close:'إغلاق',
      noCam:'الكاميرا أو قارئ الباركود غير متاح هنا. اكتب الأرقام يدويا.',noHit:'الباركود ده مش موجود في قاعدة البيانات على الجهاز.',
      listen:'بسمعك...',noVoice:'البحث بالصوت غير متاح على هذا الجهاز.',noSpeech:'ماسمعتش حاجة.',
      q:function(n){return 'ما هو دواء '+n+' وما استخداماته وبدائله؟'}},
    en:{mic:'Voice search',scan:'Scan barcode',scanTitle:'Scan the box barcode',manual:'Type the barcode digits',go:'Search',close:'Close',
      noCam:'Camera or barcode reader is not available here. Type the digits instead.',noHit:'This barcode is not in the on-device database.',
      listen:'Listening...',noVoice:'Voice search is not available on this device.',noSpeech:'I did not hear anything.',
      q:function(n){return 'What is '+n+' and what is it used for? Alternatives?'}}
  };
  var tx=function(){return L[ar()?'ar':'en']};
  var ICON={
    mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    scan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 9v6M10 9v6M14 9v6M17 9v6"/></svg>'
  };
  function ask(q){
    var i=doc.getElementById('aiInput'),f=doc.getElementById('aiComposer');if(!i||!f)return;
    i.value=q;i.dispatchEvent(new Event('input',{bubbles:true}));
    if(f.requestSubmit)f.requestSubmit();else f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  }
  function note(msg){
    var h=doc.getElementById('aiHint');if(!h)return;h.textContent=msg;clearTimeout(note.t);note.t=setTimeout(function(){if(h.textContent===msg)h.textContent=''},5000);
  }
  var table=null;
  function loadTable(){
    if(table)return Promise.resolve(table);
    return (window.DawayaNet&&window.DawayaNet.request?window.DawayaNet.request('assets/barcode-index.json',{cache:'force-cache'}):Promise.resolve(null)).then(function(r){return r.ok?r.json():null}).then(function(d){table=d&&d.codes?d.codes:{};return table}).catch(function(){table={};return table});
  }
  function resolveCode(code){
    var digits=String(code||'').replace(/\D/g,'');if(digits.length<8){note(tx().noHit);return}
    loadTable().then(function(t){
      var P=window.DawayaAIPhoto,names=P&&P.namesForCode?P.namesForCode(digits,t):[];
      if(names&&names.length)ask(tx().q(names[0]));else note(tx().noHit);
    });
  }
  function closeOv(){var o=doc.getElementById('aiScanOv');if(o){if(o._stream)o._stream.getTracks().forEach(function(t){t.stop()});o._stop=true;o.remove()}}
  function openScan(){
    var b=window.DawayaNative;
    if(b&&typeof b.scanCode==='function'){
      Promise.resolve(b.scanCode({language:ar()?'ar':'en'})).then(function(r){if(r&&r.code)resolveCode(r.code);else if(r&&!r.cancelled)manual(true)}).catch(function(){manual(true)});
      return;
    }
    manual(false);
  }
  function manual(failed){
    closeOv();
    var o=doc.createElement('div');o.className='ai-scan-ov';o.id='aiScanOv';
    var box=doc.createElement('div');box.className='ai-scan-box';
    var h=doc.createElement('strong');h.textContent=tx().scanTitle;box.appendChild(h);
    var v=doc.createElement('video');v.setAttribute('playsinline','');v.muted=true;v.hidden=true;box.appendChild(v);
    var p=doc.createElement('p');p.className='ai-scan-note';box.appendChild(p);
    var f=doc.createElement('form'),inp=doc.createElement('input'),go=doc.createElement('button');
    inp.inputMode='numeric';inp.placeholder=tx().manual;go.type='submit';go.textContent=tx().go;f.appendChild(inp);f.appendChild(go);box.appendChild(f);
    var cl=doc.createElement('button');cl.type='button';cl.textContent=tx().close;box.appendChild(cl);
    o.appendChild(box);doc.body.appendChild(o);
    cl.onclick=closeOv;o.addEventListener('click',function(e){if(e.target===o)closeOv()});
    f.onsubmit=function(e){e.preventDefault();var c=inp.value;closeOv();resolveCode(c)};
    if(failed)p.textContent=tx().noCam;
    var ok=!failed&&typeof window.BarcodeDetector==='function'&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia;
    if(!ok){if(!failed)p.textContent=tx().noCam;inp.focus();return}
    var det;try{det=new window.BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','qr_code']})}catch(_){p.textContent=tx().noCam;return}
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}).then(function(s){
      if(o._stop){s.getTracks().forEach(function(t){t.stop()});return}
      o._stream=s;v.srcObject=s;v.hidden=false;v.play().catch(function(){});
      (function tick(){
        if(o._stop)return;
        det.detect(v).then(function(r){if(r&&r.length&&r[0].rawValue){var c=r[0].rawValue;closeOv();resolveCode(c)}else setTimeout(tick,350)}).catch(function(){setTimeout(tick,500)});
      })();
    }).catch(function(){p.textContent=tx().noCam;inp.focus()});
  }
  var rec=null;
  function mic(btn){
    var b=window.DawayaNative,lang=ar()?'ar-EG':'en-US';
    if(rec){try{rec.stop()}catch(_){}return}
    function done(){btn.classList.remove('is-listening');rec=null}
    if(b&&typeof b.startVoiceSearch==='function'){
      btn.classList.add('is-listening');note(tx().listen);
      Promise.resolve(b.startVoiceSearch({language:lang})).then(function(r){done();if(r&&r.text)ask(r.text);else note(tx().noSpeech)}).catch(function(){done();note(tx().noVoice)});
      return;
    }
    var R=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!R){note(tx().noVoice);return}
    var r;try{r=new R()}catch(_){note(tx().noVoice);return}
    r.lang=lang;r.interimResults=false;r.continuous=false;rec=r;btn.classList.add('is-listening');note(tx().listen);
    var got='';
    r.onresult=function(e){for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i][0]&&e.results[i][0].transcript)got=e.results[i][0].transcript.trim()}};
    r.onerror=function(){done();note(tx().noVoice)};
    r.onend=function(){var g=got;done();if(g)ask(g);else note(tx().noSpeech)};
    try{r.start()}catch(_){done();note(tx().noVoice)}
  }
  function mk(cls,key,icon,fn){
    var b=doc.createElement('button');b.type='button';b.className='ai-tool '+cls;b.innerHTML=icon;
    b.setAttribute('aria-label',tx()[key]);b.title=tx()[key];b.addEventListener('click',function(){fn(b)});return b;
  }
  function install(){
    var bar=doc.querySelector('#aiComposer .ai-composer-bar'),send=doc.getElementById('aiSend');
    if(!bar||!send||doc.getElementById('aiScanBtn'))return;
    var s=mk('','scan',ICON.scan,openScan);s.id='aiScanBtn';
    var m=mk('','mic',ICON.mic,mic);m.id='aiMicBtn';
    var at=doc.getElementById('aiAttach');
    var ref=doc.getElementById('aiHint')||send;
    bar.insertBefore(s,ref);bar.insertBefore(m,ref);
    if(at)bar.insertBefore(at,s);
  }
  function relabel(){['aiScanBtn','aiMicBtn'].forEach(function(id){var b=doc.getElementById(id);if(b){var k=id==='aiScanBtn'?'scan':'mic';b.setAttribute('aria-label',tx()[k]);b.title=tx()[k]}})}
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',install);else install();
  setTimeout(install,1500);setTimeout(install,4000);setInterval(relabel,5000);
})();
