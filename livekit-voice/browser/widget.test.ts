// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,afterEach} from 'vitest';
const source=readFileSync('apps/api/public/widget.js','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';document.body.className='';delete (window as any).__earthoraWidgetLoaded;vi.unstubAllGlobals();});
async function setup(){
  const script=document.createElement('script');script.src='http://localhost/widget.js';script.dataset.channel='local';
  Object.defineProperty(document,'currentScript',{value:script,configurable:true});
  vi.stubGlobal('fetch',vi.fn(async()=>({json:async()=>({name:'Earthora',voiceEnabled:true,voiceChannelKey:'voice',greeting:'Welcome',starters:[]})})));
  window.matchMedia=vi.fn(()=>({matches:true} as MediaQueryList));
  Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
  HTMLCanvasElement.prototype.getContext=vi.fn(()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},createRadialGradient(){return {addColorStop(){}}}})) as any;
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  let options:any;
  const connection={disconnect:vi.fn(),resumeAudio:vi.fn(async()=>{}),setMuted:vi.fn(async(muted:boolean)=>options.onEvent({type:'microphone_state',muted}))};
  const connect=vi.fn(async(o:any)=>{options=o;o.onEvent({type:'connected'});return connection;});
  (window as any).EarthoraVoice={connect};
  window.eval(source);await tick();
  const button=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!;
  button('.ea-fab').click();button('.ea-mic').click();await tick();
  return {button,connection,connect,event:(e:any)=>options.onEvent(e),navigate:(d:any,s:AbortSignal)=>options.onNavigate(d,s)};
}
describe('compact voice widget',()=>{
  it('starts minimized, hides the competing launcher, and retains its connection through maximize/minimize',async()=>{
    const s=await setup();
    expect(document.querySelector('.ea-call-strip.open')).not.toBeNull();expect(document.querySelector('.ea-panel.open')).toBeNull();
    expect(document.body.classList.contains('ea-call-active')).toBe(true);
    s.button('.ea-call-max').click();expect(document.querySelector('.ea-panel.open .ea-voice.open')).not.toBeNull();
    s.button('.ea-voice-min').click();expect(document.querySelector('.ea-call-strip.open')).not.toBeNull();
    expect(s.connect).toHaveBeenCalledOnce();expect(s.connection.disconnect).not.toHaveBeenCalled();
    s.button('.ea-call-end').click();expect(s.connection.disconnect).toHaveBeenCalledOnce();expect(document.querySelector('.ea-call-strip.open')).toBeNull();
    expect(document.body.classList.contains('ea-call-active')).toBe(false);
  });
  it('mute/unmute changes only microphone state and keeps incoming playback available',async()=>{
    const s=await setup();s.button('.ea-call-mute').click();await tick();
    expect(s.connection.setMuted).toHaveBeenLastCalledWith(true);expect(s.button('.ea-call-mute').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.ea-call-state')!.textContent).toBe('Microphone muted');
    s.event({type:'agent_reply_text',text:'Still audible'});expect(document.querySelector('.ea-call-state')!.textContent).toBe('Microphone muted');
    s.button('.ea-call-mute').click();await tick();expect(s.connection.setMuted).toHaveBeenLastCalledWith(false);
    expect(s.connection.disconnect).not.toHaveBeenCalled();
    s.event({type:'playback_blocked'});expect(s.button('.ea-call-play').style.display).toBe('flex');
    s.button('.ea-call-play').click();await tick();expect(s.connection.resumeAudio).toHaveBeenCalledOnce();
    s.button('.ea-call-end').click();
  });
  it('uses the SPA bridge without ending the call and rejects unsupported standalone hosts',async()=>{
    const s=await setup();const destination={id:'contact',path:'/contact',anchor:null,label:'Contact'};
    delete (window as any).EarthoraStorefrontNavigation;
    expect(await s.navigate(destination,new AbortController().signal)).toEqual({ok:false,reason:'unsupported_page'});
    const navigate=vi.fn(async()=>({ok:true}));(window as any).EarthoraStorefrontNavigation={navigate};
    s.button('.ea-call-max').click();expect(await s.navigate(destination,new AbortController().signal)).toEqual({ok:true});
    expect(navigate).toHaveBeenCalledOnce();expect(s.connection.disconnect).not.toHaveBeenCalled();expect(document.querySelector('.ea-call-strip.open')).not.toBeNull();
    s.button('.ea-call-end').click();delete (window as any).EarthoraStorefrontNavigation;
  });
});
