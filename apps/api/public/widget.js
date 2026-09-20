/* Earthora AI chat + voice widget — single-file embed. Usage:
   <script src="https://.../widget.js" data-channel="pk_xxx" defer></script>
   Renders a launcher; opens a chat panel with an animated voice orb. */
(function () {
  'use strict';
  var script = document.currentScript;
  var CHANNEL = script && script.getAttribute('data-channel');
  var API = (script && script.getAttribute('data-api')) || new URL(script.src).origin;
  if (!CHANNEL) return;
  if (window.__earthoraWidgetLoaded) return; // a second embed would stack two launchers
  window.__earthoraWidgetLoaded = true;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = '\
  .ea-fab{position:fixed;bottom:22px;right:22px;width:60px;height:60px;border-radius:50%;background:#26593b;box-shadow:0 8px 30px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .2s;border:none;padding:0}\
  .ea-fab:hover{transform:scale(1.06)}.ea-fab svg{width:26px;height:26px;fill:#faf8f3}\
  .ea-fab:focus-visible,.ea-panel button:focus-visible,.ea-chip:focus-visible,.ea-in:focus-visible{outline:3px solid #DC9950;outline-offset:2px}\
  .ea-panel{position:fixed;bottom:94px;right:22px;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 120px);background:#faf8f3;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:Outfit,system-ui,Segoe UI,sans-serif}\
  .ea-panel.open{display:flex}\
  @media (max-width:480px){.ea-panel{bottom:0;right:0;left:0;width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0}.ea-fab{bottom:16px;right:16px}}\
  .ea-head{background:#26593b;color:#faf8f3;padding:16px 18px;display:flex;align-items:center;gap:10px;flex-shrink:0}\
  .ea-head .ea-ttl{font-weight:600;font-size:15px;flex:1;margin:0}\
  .ea-head .ea-x{cursor:pointer;opacity:.85;font-size:20px;line-height:1;background:none;border:none;color:inherit;width:32px;height:32px;border-radius:8px}\
  .ea-head .ea-x:hover{opacity:1;background:rgba(255,255,255,.12)}\
  .ea-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#faf8f3}\
  .ea-b{max-width:82%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}\
  .ea-b.u{align-self:flex-end;background:#26593b;color:#fff;border-bottom-right-radius:5px}\
  .ea-b.a{align-self:flex-start;background:#fff;color:#15271d;border:1px solid #e3e8e4;border-bottom-left-radius:5px}\
  .ea-b.err{align-self:flex-start;background:#fdf1e7;color:#7a3e12;border:1px solid #f0d3b8}\
  .ea-starters{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;flex-shrink:0}\
  .ea-chip{border:1px solid #cfdcd3;background:#fff;color:#26593b;border-radius:999px;padding:8px 13px;font-size:12px;cursor:pointer;font-family:inherit}\
  .ea-chip:hover{background:#f0f4ee}\
  .ea-foot{border-top:1px solid #e3e8e4;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff;flex-shrink:0}\
  .ea-in{flex:1;border:1px solid #d8e0d9;border-radius:12px;padding:10px 12px;font-size:16px;outline:none;resize:none;max-height:80px;font-family:inherit;color:#15271d;background:#fff}\
  .ea-in:focus{border-color:#26593b}\
  .ea-send,.ea-mic{width:44px;height:44px;border-radius:12px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}\
  .ea-send{background:#26593b}.ea-send svg{width:18px;height:18px;fill:#fff}\
  .ea-send[disabled]{opacity:.5;cursor:not-allowed}\
  .ea-mic{background:#f0f4ee}.ea-mic svg{width:18px;height:18px;fill:#26593b}\
  .ea-voice{position:absolute;inset:0;background:#0f1a13;display:none;flex-direction:column;align-items:center;justify-content:center;z-index:5}\
  .ea-voice.open{display:flex}\
  .ea-orb-wrap{width:200px;height:200px;display:flex;align-items:center;justify-content:center}\
  .ea-cap{color:#cfe0d4;font-size:14px;text-align:center;padding:0 30px;margin-top:24px;min-height:40px;line-height:1.5}\
  .ea-voice-x{position:absolute;top:12px;right:12px;color:#cfe0d4;cursor:pointer;font-size:22px;background:none;border:none;width:40px;height:40px;border-radius:10px;z-index:6}\
  .ea-voice-x:hover{background:rgba(255,255,255,.12)}\
  .ea-vstop{margin-top:22px;background:#DC9950;color:#15271d;border:none;border-radius:999px;padding:12px 26px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;min-height:44px}\
  .ea-vstop[disabled]{opacity:.55;cursor:not-allowed}\
  .ea-vstate{color:#7fae90;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-top:8px}\
  .ea-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9bb3a5;animation:eab 1.2s infinite}@keyframes eab{0%,80%,100%{opacity:.3}40%{opacity:1}}\
  .ea-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}\
  @media (prefers-reduced-motion: reduce){.ea-fab,.ea-fab:hover{transition:none;transform:none}.ea-dot{animation:none;opacity:.7}}';

  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var fab = document.createElement('button');
  fab.className = 'ea-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open the Earthora assistant');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.5 1.2 4.7 3.2 6.3L4.5 21l3.6-1.4c1.2.4 2.5.6 3.9.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>';
  document.body.appendChild(fab);

  var panel = document.createElement('div');
  panel.className = 'ea-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Earthora assistant');
  panel.innerHTML =
    '<div class="ea-head"><h2 class="ea-ttl">Assistant</h2><button type="button" class="ea-x" aria-label="Close the assistant">×</button></div>' +
    '<div class="ea-msgs" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation"></div>' +
    '<div class="ea-starters"></div>' +
    '<div class="ea-foot">' +
      '<label class="ea-sr" for="ea-input">Type a message to the assistant</label>' +
      '<textarea id="ea-input" class="ea-in" rows="1" placeholder="Type a message…"></textarea>' +
      '<button type="button" class="ea-mic" aria-label="Speak to the assistant"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z"/></svg></button>' +
      '<button type="button" class="ea-send" aria-label="Send message"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg></button>' +
    '</div>' +
    '<div class="ea-voice" role="dialog" aria-label="Voice conversation">' +
      '<button type="button" class="ea-voice-x" aria-label="Close voice mode">×</button>' +
      '<div class="ea-orb-wrap"><canvas class="ea-orb" width="360" height="360" style="width:200px;height:200px" aria-hidden="true"></canvas></div>' +
      '<p class="ea-vstate" aria-hidden="true">idle</p>' +
      '<p class="ea-cap" role="status" aria-live="polite"></p>' +
      '<button type="button" class="ea-vstop">Stop and send</button>' +
    '</div>';
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.ea-msgs'), input = panel.querySelector('.ea-in'), starters = panel.querySelector('.ea-starters');
  var voicePane = panel.querySelector('.ea-voice'), cap = panel.querySelector('.ea-cap'), vstate = panel.querySelector('.ea-vstate');
  var micBtn = panel.querySelector('.ea-mic'), sendBtn = panel.querySelector('.ea-send'), stopBtn = panel.querySelector('.ea-vstop');
  var convId = null, cfg = { name: 'Assistant', greeting: '', starters: [], voiceEnabled: false, voiceChannelKey: null };

  micBtn.style.display = 'none'; // shown only once config confirms a voice channel

  fetch(API + '/api/platform/chat/' + encodeURIComponent(CHANNEL) + '/config')
    .then(function (r) { return r.json(); })
    .then(function (c) {
      cfg = Object.assign(cfg, c);
      panel.querySelector('.ea-ttl').textContent = c.name || 'Assistant';
      panel.setAttribute('aria-label', (c.name || 'Assistant') + ' chat');
      fab.setAttribute('aria-label', 'Open the ' + (c.name || 'Earthora') + ' assistant');
      if (c.appearance && c.appearance.primary) fab.style.background = c.appearance.primary;
      // The mic only appears when there is a voice channel it can actually
      // reach; the voice endpoints reject this widget's chat key.
      if (cfg.voiceEnabled && cfg.voiceChannelKey) micBtn.style.display = '';
      (c.starters || []).forEach(function (s) {
        var chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'ea-chip'; chip.textContent = s;
        chip.onclick = function () { send(s); };
        starters.appendChild(chip);
      });
    })
    .catch(function () { /* chat still works with defaults */ });

  function open() {
    panel.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    if (!msgs.children.length && cfg.greeting) addMsg('a', cfg.greeting);
    input.focus();
  }
  function close() {
    stopVoice();
    voicePane.classList.remove('open');
    panel.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }
  fab.onclick = function () { panel.classList.contains('open') ? close() : open(); };
  panel.querySelector('.ea-x').onclick = close;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !panel.classList.contains('open')) return;
    if (voicePane.classList.contains('open')) { closeVoice(); return; }
    close();
  });

  function addMsg(role, text) {
    var b = document.createElement('div');
    b.className = 'ea-b ' + role;
    b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function send(text) {
    text = (text || input.value).trim();
    if (!text || sendBtn.disabled) return;
    input.value = ''; starters.style.display = 'none';
    addMsg('u', text);
    var bubble = addMsg('a', '');
    bubble.innerHTML = '<span class="ea-dot"></span><span class="ea-sr">Assistant is typing</span>';
    sendBtn.disabled = true;

    fetch(API + '/api/platform/chat/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelKey: CHANNEL, conversationId: convId, message: text })
    })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('http ' + res.status);
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', first = true;
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split('\n\n'); buf = parts.pop();
            parts.forEach(function (p) {
              var ev = (p.match(/event: (\w+)/) || [])[1], d = (p.match(/data: (.+)/) || [])[1];
              if (!d) return;
              var j; try { j = JSON.parse(d); } catch (e) { return; }
              if (ev === 'meta') convId = j.conversationId;
              else if (ev === 'delta') { if (first) { bubble.textContent = ''; first = false; } bubble.textContent += j.text; msgs.scrollTop = msgs.scrollHeight; }
              else if (ev === 'done') { bubble.textContent = j.reply; convId = j.conversationId; }
              else if (ev === 'error') { bubble.className = 'ea-b err'; bubble.textContent = j.message; }
            });
            return pump();
          });
        })();
      })
      .catch(function () {
        bubble.className = 'ea-b err';
        bubble.textContent = 'Sorry, I could not reach the assistant. Please check your connection and try again.';
      })
      .then(function () { sendBtn.disabled = false; input.focus(); });
  }
  sendBtn.onclick = function () { send(); };
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  /* ── Animated voice orb ── */
  var orb = panel.querySelector('.ea-orb'), octx = orb.getContext('2d'), level = 0, phase = 0, orbState = 'idle', raf = null;
  function drawOrb() {
    var w = orb.width, h = orb.height, cx = w / 2, cy = h / 2;
    octx.clearRect(0, 0, w, h);
    if (!reduceMotion) phase += 0.03;
    var base = 90, amp = orbState === 'speaking' ? 18 + level * 60 : orbState === 'listening' ? 10 + level * 70 : orbState === 'thinking' ? 12 : 8;
    if (reduceMotion) amp = 10;
    for (var ring = 0; ring < 3; ring++) {
      octx.beginPath();
      for (var a = 0; a <= Math.PI * 2 + 0.1; a += 0.12) {
        var r = base - ring * 16 + Math.sin(a * 3 + phase + ring) * amp * 0.4 + Math.sin(a * 5 - phase * 1.3) * amp * 0.3;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        a === 0 ? octx.moveTo(x, y) : octx.lineTo(x, y);
      }
      octx.closePath();
      var g = octx.createRadialGradient(cx, cy, 20, cx, cy, base + 20);
      g.addColorStop(0, 'rgba(120,200,150,' + (0.5 - ring * 0.12) + ')');
      g.addColorStop(1, orbState === 'listening' ? '#DC9950' : '#2f6d48');
      octx.fillStyle = g;
      octx.globalAlpha = 0.55 - ring * 0.14;
      octx.fill();
    }
    octx.globalAlpha = 1;
    raf = requestAnimationFrame(drawOrb);
  }
  // Same controls and layout; LiveKit owns continuous audio and turn detection.
  var voiceConnection = null, voiceAbort = null, voiceLoad = null, voiceTurn = 0;
  var voiceConversationId = null, playbackBlocked = false;
  function setVState(s, text) {
    orbState = s;
    vstate.textContent = s;
    if (text !== undefined) cap.textContent = text;
    stopBtn.textContent = playbackBlocked ? 'Play audio' : s === 'idle' ? 'Start speaking' : s === 'connecting' ? 'Connecting...' : 'End call';
    stopBtn.disabled = s === 'connecting';
  }
  function loadVoiceClient() {
    if (window.EarthoraVoice) return Promise.resolve();
    if (!voiceLoad) voiceLoad = new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = API + '/voice-client.js';
      tag.onload = resolve;
      tag.onerror = function () { voiceLoad = null; tag.remove(); reject(new Error('Voice could not load. Please try again.')); };
      document.head.appendChild(tag);
    });
    return voiceLoad;
  }
  micBtn.onclick = openVoice;
  panel.querySelector('.ea-voice-x').onclick = closeVoice;
  stopBtn.onclick = function () {
    if (playbackBlocked && voiceConnection) {
      voiceConnection.resumeAudio().then(function () { playbackBlocked = false; setVState('listening', 'Listening... speak naturally.'); });
    } else if (orbState === 'idle') startVoice();
    else closeVoice();
  };
  function openVoice() {
    if (!cfg.voiceChannelKey) return;
    voicePane.classList.add('open');
    if (raf === null) drawOrb();
    startVoice();
    stopBtn.focus();
  }
  function closeVoice() {
    stopVoice();
    voicePane.classList.remove('open');
    micBtn.focus();
  }
  function stopVoice() {
    voiceTurn++;
    if (voiceAbort) { voiceAbort.abort(); voiceAbort = null; }
    if (voiceConnection) { voiceConnection.disconnect(); voiceConnection = null; }
    playbackBlocked = false; level = 0;
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    setVState('idle', '');
  }
  function startVoice() {
    if (!navigator.mediaDevices) { setVState('idle', 'Voice is not supported in this browser. You can still type your question.'); return; }
    if (voiceAbort) voiceAbort.abort();
    var myTurn = ++voiceTurn;
    voiceAbort = new AbortController();
    playbackBlocked = false;
    if (raf === null) drawOrb();
    setVState('connecting', 'Connecting your voice call...');
    loadVoiceClient().then(function () {
      if (myTurn !== voiceTurn) return;
      return window.EarthoraVoice.connect({
        baseUrl: API, channelKey: cfg.voiceChannelKey, conversationId: voiceConversationId,
        signal: voiceAbort.signal,
        onLevel: function (value) { if (myTurn === voiceTurn) level = value; },
        onEvent: function (event) {
          if (myTurn !== voiceTurn) return;
          if (event.type === 'connected') {
            if (event.conversationId) voiceConversationId = event.conversationId;
            setVState('listening', 'Listening... speak naturally.');
          } else if (event.type === 'user_transcript') {
            if (event.text && event.is_final !== false) addMsg('u', event.text);
            setVState('thinking', 'Thinking...');
          } else if (event.type === 'agent_reply_text') {
            if (event.text) { addMsg('a', event.text); setVState('speaking', event.text); }
          } else if (event.type === 'agent_state') {
            var state = event.state === 'speaking' ? 'speaking' : event.state === 'thinking' ? 'thinking' : 'listening';
            setVState(state, state === 'listening' ? 'Listening... speak naturally.' : undefined);
          } else if (event.type === 'user_state' && event.state === 'speaking') {
            setVState('listening', 'Listening...');
          } else if (event.type === 'playback_blocked') {
            playbackBlocked = true; setVState(orbState, 'Tap Play audio to hear the assistant.');
          } else if (event.type === 'reconnecting') {
            setVState('connecting', 'Reconnecting...');
          } else if (event.type === 'call_end' || event.type === 'disconnected') {
            stopVoice(); setVState('idle', 'Call ended. Tap Start speaking to reconnect.');
          } else if (event.type === 'error') {
            setVState('listening', event.message || 'I missed that. Please try again.');
          }
        }
      });
    }).then(function (connection) {
      if (!connection) return;
      if (myTurn !== voiceTurn) { connection.disconnect(); return; }
      voiceConnection = connection;
    }).catch(function (error) {
      if (myTurn !== voiceTurn || error.name === 'AbortError') return;
      var message = error.name === 'NotAllowedError' ? 'Allow microphone access, then tap Start speaking.' : error.message || 'Voice could not connect. Please try again.';
      stopVoice(); setVState('idle', message);
    });
  }
})();
