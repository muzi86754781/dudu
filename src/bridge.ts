import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export const desktop=isTauri();
export async function call<T>(command:string,args:Record<string,unknown>={}):Promise<T>{if(!desktop)throw new Error('此操作需要 dudu 桌面应用。网页当前为界面预览。');try{return await invoke<T>(command,args)}catch(e){throw new Error(typeof e==='string'?e:String(e))}}
export async function on<T>(event:string,handler:(data:T)=>void){if(!desktop)return ()=>{};return listen<T>(event,e=>handler(e.payload))}
