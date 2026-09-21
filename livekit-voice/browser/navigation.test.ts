import { describe, it, expect, vi } from 'vitest';
import { createNavigationHandler, validateNavigation } from './navigation';

const destination={id:'home_benefits',path:'/',anchor:'benefits',label:'Benefits'};
const action={action_id:'action-1',destination_id:destination.id,path:'/',anchor:'benefits'};
describe('public voice navigation',()=>{
  it('requires an exact canonical destination and ignores the model label',()=>{
    expect(validateNavigation({...action,label:'Fake label'},[destination])).toEqual(destination);
    expect(validateNavigation({...action,anchor:'contact-form'},[destination])).toBeUndefined();
    expect(validateNavigation({...action,destination_id:'contact'},[destination])).toBeUndefined();
  });
  it.each(['https://evil.example/','//evil.example/','javascript:alert(1)','/sun-earthora/dashboard','/voice-checkout/token','/product/../contact','/product/a%2fb','/contact?next=evil','/contact#form','\\evil'])('rejects non-public path %s even if returned in a manifest',path=>{
    expect(validateNavigation({...action,path},[{...destination,path}])).toBeUndefined();
  });
  it('accepts exact active product identifiers supplied by the guide',()=>{
    const d={id:'product:abc-123',path:'/product/abc-123',anchor:null,label:'Product'};
    expect(validateNavigation({action_id:'a',destination_id:d.id,path:d.path},[d])).toEqual(d);
    expect(validateNavigation({action_id:'a',destination_id:d.id,path:'/product/other'},[d])).toBeUndefined();
  });
  it('does not acknowledge completion until navigation commits, and deduplicates retransmits',async()=>{
    let done!:(value:{ok:boolean})=>void;
    const navigate=vi.fn(()=>new Promise<{ok:boolean}>(resolve=>done=resolve)),sendResult=vi.fn(async()=>{}),loadGuide=vi.fn(async()=>[destination]);
    const handler=createNavigationHandler({loadGuide,navigate,sendResult});
    const first=handler.handle(action),duplicate=handler.handle(action);
    await Promise.resolve();await Promise.resolve();
    expect(navigate).toHaveBeenCalledTimes(1);expect(sendResult).not.toHaveBeenCalled();
    done({ok:true});await Promise.all([first,duplicate]);
    expect(sendResult).toHaveBeenCalledTimes(2);
    expect(sendResult).toHaveBeenLastCalledWith(expect.objectContaining({ok:true,type:'client_action_result',action_id:'action-1'}));
    await handler.handle({...action,anchor:'faq'});
    expect(sendResult).toHaveBeenLastCalledWith(expect.objectContaining({ok:false,reason:'action_conflict'}));
    expect(loadGuide).toHaveBeenCalledTimes(1);handler.close();
  });
  it('closing a call aborts page waiting and suppresses late success acknowledgements',async()=>{
    const navigate=vi.fn((_d,signal:AbortSignal)=>new Promise<{ok:boolean;reason:string}>(resolve=>signal.addEventListener('abort',()=>resolve({ok:false,reason:'navigation_cancelled'}))));
    const sendResult=vi.fn(async()=>{});
    const handler=createNavigationHandler({loadGuide:async()=>[destination],navigate,sendResult});
    const task=handler.handle(action);await Promise.resolve();await Promise.resolve();
    handler.close();await task;
    expect(navigate.mock.calls[0][1].aborted).toBe(true);expect(sendResult).not.toHaveBeenCalled();
  });
  it('cancels an interrupted action while its guide is still loading',async()=>{
    let resolveGuide!:(value:typeof destination[])=>void;
    const navigate=vi.fn(async()=>({ok:true})),sendResult=vi.fn(async()=>{});
    const handler=createNavigationHandler({loadGuide:()=>new Promise(resolve=>resolveGuide=resolve),navigate,sendResult});
    const task=handler.handle(action);handler.cancel(action.action_id);resolveGuide([destination]);await task;
    expect(navigate).not.toHaveBeenCalled();expect(sendResult).toHaveBeenCalledWith(expect.objectContaining({ok:false,reason:'navigation_cancelled'}));handler.close();
  });
  it('never navigates after the deadline even when a suspended guide eventually resolves',async()=>{
    let now=1000;
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
    const navigate=vi.fn(async()=>({ok:true})),sendResult=vi.fn(async()=>{});
    const handler=createNavigationHandler({loadGuide:async()=>{now+=9000;return [destination];},navigate,sendResult});
    await handler.handle(action);
    expect(navigate).not.toHaveBeenCalled();expect(sendResult).toHaveBeenCalledWith(expect.objectContaining({ok:false,reason:'navigation_timeout'}));
    handler.close();clock.mockRestore();
  });
  it('bounds a stalled manifest without moving the page',async()=>{
    vi.useFakeTimers();
    const navigate=vi.fn(async()=>({ok:true})),sendResult=vi.fn(async()=>{});
    const handler=createNavigationHandler({loadGuide:()=>new Promise(()=>{}),navigate,sendResult});
    const pending=handler.handle(action);await vi.advanceTimersByTimeAsync(4000);await pending;
    expect(navigate).not.toHaveBeenCalled();expect(sendResult).toHaveBeenCalledWith(expect.objectContaining({ok:false,reason:'guide_unavailable'}));handler.close();vi.useRealTimers();
  });
});
