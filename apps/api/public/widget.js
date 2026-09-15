/* Earthora AI chat + voice widget — single-file embed. Usage:
   <script src="https://.../widget.js" data-channel="pk_xxx" defer></script>
   Renders a launcher; opens a chat panel with an animated voice orb (ElevenLabs-style). */
(function () {
  'use strict';
  var script = document.currentScript;
  var CHANNEL = script && script.getAttribute('data-channel');
  var API = (script && script.getAttribute('data-api')) || new URL(script.src).origin;
  if (!CHANNEL) return;

  var css = '\
  .ea-fab{position:fixed;bottom:22px;right:22px;width:60px;height:60px;border-radius:50%;background:#26593b;box-shadow:0 8px 30px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .2s}\
  .ea-fab:hover{transform:scale(1.06)}.ea-fab svg{width:26px;height:26px;fill:#faf8f3}\
  .ea-panel{position:fixed;bottom:94px;right:22px;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 120px);background:#faf8f3;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:Outfit,system-ui,Segoe UI,sans-serif}\
  .ea-panel.open{display:flex}\
  .ea-head{background:#26593b;color:#faf8f3;padding:16px 18px;display:flex;align-items:center;gap:10px}\
  .ea-head .ea-ttl{font-weight:600;font-size:15px;flex:1}.ea-head .ea-x{cursor:pointer;opacity:.8;font-size:20px;line-height:1}\
  .ea-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#faf8f3}\
  .ea-b{max-width:82%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap}\
  .ea-b.u{align-self:flex-end;background:#26593b;color:#fff;border-bottom-right-radius:5px}\
  .ea-b.a{align-self:flex-start;background:#fff;color:#15271d;border:1px solid #e3e8e4;border-bottom-left-radius:5px}\
  .ea-starters{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}\
  .ea-chip{border:1px solid #cfdcd3;background:#fff;color:#26593b;border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer}\
  .ea-chip:hover{background:#f0f4ee}\
  .ea-foot{border-top:1px solid #e3e8e4;padding:10px;display:flex;gap:8px;align-items:center;background:#fff}\
  .ea-in{flex:1;border:1px solid #d8e0d9;border-radius:12px;padding:10px 12px;font-size:14px;outline:none;resize:none;max-height:80px;font-family:inherit}\
  .ea-in:focus{border-color:#26593b}\
  .ea-send,.ea-mic{width:40px;height:40px;border-radius:12px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}\
  .ea-send{background:#26593b}.ea-send svg{width:18px;height:18px;fill:#fff}\
  .ea-mic{background:#f0f4ee}.ea-mic svg{width:18px;height:18px;fill:#26593b}.ea-mic.rec{background:#DC9950}.ea-mic.rec svg{fill:#fff}\
  .ea-voice{position:absolute;inset:0;background:#0f1a13;display:none;flex-direction:column;align-items:center;justify-content:center;z-index:5}\
  .ea-voice.open{display:flex}\
  .ea-orb-wrap{width:200px;height:200px;display:flex;align-items:center;justify-content:center}\
  .ea-cap{color:#cfe0d4;font-size:14px;text-align:center;padding:0 30px;margin-top:24px;min-height:40px}\
  .ea-voice-x{position:absolute;top:16px;right:18px;color:#9fc0a8;cursor:pointer;font-size:22px}\
  .ea-vstate{color:#7fae90;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-top:8px}\
  .ea-dot{width:7px;height:7px;border-radius:50%;background:#9bb3a5;animation:eab 1.2s infinite}@keyframes eab{0%,80%,100%{opacity:.3}40%{opacity:1}}';

  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var fab = document.createElement('div'); fab.className = 'ea-fab';
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.5 1.2 4.7 3.2 6.3L4.5 21l3.6-1.4c1.2.4 2.5.6 3.9.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>';
  document.body.appendChild(fab);

  var panel = document.createElement('div'); panel.className = 'ea-panel';
  panel.innerHTML =
    '<div class="ea-head"><div class="ea-ttl">Assistant</div><div class="ea-x">×</div></div>' +
    '<div class="ea-msgs"></div>' +
    '<div class="ea-starters"></div>' +
    '<div class="ea-foot"><textarea class="ea-in" rows="1" placeholder="Type a message…"></textarea><button class="ea-mic" title="Speak"><svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z"/></svg></button><button class="ea-send"><svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg></button></div>' +
    '<div class="ea-voice"><div class="ea-voice-x">×</div><div class="ea-orb-wrap"><canvas class="ea-orb" width="360" height="360" style="width:200px;height:200px"></canvas></div><div class="ea-vstate">idle</div><div class="ea-cap"></div></div>';
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.ea-msgs'), input = panel.querySelector('.ea-in'), starters = panel.querySelector('.ea-starters');
  var voicePane = panel.querySelector('.ea-voice'), cap = panel.querySelector('.ea-cap'), vstate = panel.querySelector('.ea-vstate');
  var convId = null, cfg = { name: 'Assistant', greeting: '', starters: [], voiceEnabled: true };

  fetch(API + '/api/platform/chat/' + CHANNEL + '/config').then(function (r) { return r.json(); }).then(function (c) {
    cfg = Object.assign(cfg, c);
    panel.querySelector('.ea-ttl').textContent = c.name || 'Assistant';
    if (c.appearance && c.appearance.primary) { document.querySelectorAll('.ea-fab,.ea-head,.ea-send,.ea-b.u').forEach(function () {}); fab.style.background = c.appearance.primary; }
    if (!c.voiceEnabled) panel.querySelector('.ea-mic').style.display = 'none';
    (c.starters || []).forEach(function (s) { var ch = document.createElement('div'); ch.className = 'ea-chip'; ch.textContent = s; ch.onclick = function () { send(s); }; starters.appendChild(ch); });
  }).catch(function () {});

  function open() { panel.classList.add('open'); if (!msgs.children.length && cfg.greeting) addMsg('a', cfg.greeting); input.focus(); }
  fab.onclick = function () { panel.classList.contains('open') ? panel.classList.remove('open') : open(); };
  panel.querySelector('.ea-x').onclick = function () { panel.classList.remove('open'); };

  function addMsg(role, text) { var b = document.createElement('div'); b.className = 'ea-b ' + role; b.textContent = text; msgs.appendChild(b); msgs.scrollTop = msgs.scrollHeight; return b; }

  function send(text) {
    text = (text || input.value).trim(); if (!text) return; input.value = ''; starters.style.display = 'none';
    addMsg('u', text); var bubble = addMsg('a', ''); bubble.innerHTML = '<span class="ea-dot"></span>';
    fetch(API + '/api/platform/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelKey: CHANNEL, conversationId: convId, message: text }) })
      .then(function (res) {
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', first = true;
        (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return; buf += dec.decode(r.value, { stream: true }); var parts = buf.split('\n\n'); buf = parts.pop();
            parts.forEach(function (p) {
              var ev = (p.match(/event: (\w+)/) || [])[1], d = (p.match(/data: (.+)/) || [])[1]; if (!d) return; var j = JSON.parse(d);
              if (ev === 'meta') convId = j.conversationId;
              else if (ev === 'delta') { if (first) { bubble.textContent = ''; first = false; } bubble.textContent += j.text; msgs.scrollTop = msgs.scrollHeight; }
              else if (ev === 'done') { bubble.textContent = j.reply; convId = j.conversationId; }
              else if (ev === 'error') { bubble.textContent = j.message; }
            });
            return pump();
          });
        })();
      }).catch(function () { bubble.textContent = 'Sorry, something went wrong.'; });
  }
  panel.querySelector('.ea-send').onclick = function () { send(); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  /* ── Animated voice orb ── */
  var orb = panel.querySelector('.ea-orb'), octx = orb.getContext('2d'), level = 0, phase = 0, orbState = 'idle', raf;
  function drawOrb() {
    var w = orb.width, h = orb.height, cx = w / 2, cy = h / 2; octx.clearRect(0, 0, w, h);
    phase += 0.03; var base = 90, amp = orbState === 'speaking' ? 18 + level * 60 : orbState === 'listening' ? 10 + level * 70 : orbState === 'thinking' ? 12 : 8;
    for (var ring = 0; ring < 3; ring++) {
      octx.beginPath();
      for (var a = 0; a <= Math.PI * 2 + 0.1; a += 0.12) {
        var r = base - ring * 16 + Math.sin(a * 3 + phase + ring) * amp * 0.4 + Math.sin(a * 5 - phase * 1.3) * amp * 0.3;
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; a === 0 ? octx.moveTo(x, y) : octx.lineTo(x, y);
      }
      octx.closePath();
      var g = octx.createRadialGradient(cx, cy, 20, cx, cy, base + 20);
      var c1 = orbState === 'listening' ? '#DC9950' : '#2f6d48';
      g.addColorStop(0, 'rgba(120,200,150,' + (0.5 - ring * 0.12) + ')'); g.addColorStop(1, c1); octx.fillStyle = g;
      octx.globalAlpha = 0.55 - ring * 0.14; octx.fill();
    }
    octx.globalAlpha = 1; raf = requestAnimationFrame(drawOrb);
  }
  function setVState(s, text) { orbState = s; vstate.textContent = s; if (text !== undefined) cap.textContent = text; }

  var mediaRec, chunks = [], stream, audioCtx, analyser, dataArr;
  panel.querySelector('.ea-mic').onclick = function () { voicePane.classList.add('open'); startVoice(); };
  panel.querySelector('.ea-voice-x').onclick = function () { voicePane.classList.remove('open'); stopVoice(); };

  function startVoice() {
    if (!navigator.mediaDevices) { setVState('idle', 'Microphone not available'); return; }
    cancelAnimationFrame(raf); drawOrb(); setVState('listening', 'Listening… tap the mic to stop');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s; audioCtx = new (window.AudioContext || window.webkitAudioContext)(); var src = audioCtx.createMediaStreamSource(s);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; dataArr = new Uint8Array(analyser.frequencyBinCount); src.connect(analyser);
      (function meter() { if (!analyser) return; analyser.getByteFrequencyData(dataArr); var sum = 0; for (var i = 0; i < dataArr.length; i++) sum += dataArr[i]; level = Math.min(1, sum / dataArr.length / 90); if (orbState === 'listening' || orbState === 'speaking') requestAnimationFrame(meter); })();
      chunks = []; mediaRec = new MediaRecorder(s); mediaRec.ondataavailable = function (e) { chunks.push(e.data); };
      mediaRec.onstop = sendVoice; mediaRec.start();
      // auto-stop after 12s or on second mic tap
      panel.querySelector('.ea-mic').onclick = function () { if (mediaRec && mediaRec.state === 'recording') mediaRec.stop(); };
    }).catch(function () { setVState('idle', 'Microphone permission denied'); });
  }
  function stopVoice() { try { if (mediaRec && mediaRec.state === 'recording') mediaRec.stop(); } catch (e) {} if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); if (audioCtx) audioCtx.close(); analyser = null; cancelAnimationFrame(raf); }

  function sendVoice() {
    setVState('thinking', 'Thinking…'); level = 0;
    var blob = new Blob(chunks, { type: 'audio/webm' }); var fd = new FormData(); fd.append('audio', blob, 'a.webm');
    fetch(API + '/api/platform/voice/turn?channelKey=' + CHANNEL + (convId ? '&conversationId=' + convId : ''), { method: 'POST', body: fd })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.conversationId) convId = j.conversationId;
        if (j.transcript) addMsg('u', j.transcript);
        if (j.reply) { addMsg('a', j.reply); setVState('speaking', j.reply); }
        if (j.audioBase64) {
          var au = new Audio('data:' + (j.audioMime || 'audio/mpeg') + ';base64,' + j.audioBase64);
          au.onended = function () { if (voicePane.classList.contains('open')) startVoice(); };
          au.play().catch(function () {});
          // drive orb from playback amplitude
          try { var ac = new (window.AudioContext || window.webkitAudioContext)(); var srcN = ac.createMediaElementSource(au); analyser = ac.createAnalyser(); analyser.fftSize = 256; dataArr = new Uint8Array(analyser.frequencyBinCount); srcN.connect(analyser); analyser.connect(ac.destination); (function m2() { if (!analyser) return; analyser.getByteFrequencyData(dataArr); var s = 0; for (var i = 0; i < dataArr.length; i++) s += dataArr[i]; level = Math.min(1, s / dataArr.length / 80); requestAnimationFrame(m2); })(); } catch (e) {}
        } else if (voicePane.classList.contains('open')) { setTimeout(startVoice, 600); }
      }).catch(function () { setVState('listening', 'Sorry, I missed that — try again'); });
  }
})();
