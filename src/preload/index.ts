// The only bridge between the sandboxed renderer and main: a fixed list of named calls, no generic invoke.
import { contextBridge, ipcRenderer } from 'electron';
import type { ChatEvent } from '../shared/contracts.ts';

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  settings: { get: call('settings:get'), set: call('settings:set'), effective: call('config:effective') },
  state: call('state:get'),
  ui: { get: call('ui:get'), setMode: call('ui:setMode'), setConversation: call('ui:setConversation'), resizeIsland: call('island:resize') },
  conv: { list: call('conv:list'), get: call('conv:get'), create: call('conv:create'), remove: call('conv:delete'), exportMd: call('conv:export') },
  chat: { send: call('chat:send'), edit: call('chat:edit'), interrupt: call('chat:interrupt') },
  approval: { decide: call('approval:decide') },
  speech: { transcribe: call('speech:transcribe'), synthesize: call('speech:synthesize'), voices: call('speech:voices'), chooseModelsDir: call('speech:chooseModelsDir') },
  memory: { list: call('memory:list'), add: call('memory:add'), update: call('memory:update'), remove: call('memory:delete') },
  diag: { get: call('diag:get'), exportJson: call('diag:export') },
  openExternal: call('app:openExternal'),
  onEvent(fn: (ev: ChatEvent) => void) {
    const listener = (_e: unknown, ev: ChatEvent) => fn(ev);
    ipcRenderer.on('event', listener);
    return () => { ipcRenderer.removeListener('event', listener); };
  },
};

contextBridge.exposeInMainWorld('jarvis', api);
export type JarvisApi = typeof api;
