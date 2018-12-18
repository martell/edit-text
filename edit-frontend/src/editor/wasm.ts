
import 'react';

import * as route from '../ui/route';
import * as index from '..';
import { WasmClientController as WasmClientModule, FrontendCommand, ControllerCommand } from '../bindgen/edit_client';
import { getWasmModule } from '../index';
import { ControllerImpl } from './controller';
import DEBUG from '../debug';

declare var CONFIG: any;

let _convertMarkdownToDoc: ((x: string) => any) | null = null;
let _convertMarkdownToHtml: ((x: string) => any) | null = null;
getWasmModule()
.then(Module => {
  _convertMarkdownToDoc = Module.convertMarkdownToDoc;
  _convertMarkdownToHtml = Module.convertMarkdownToHtml;
});

export function convertMarkdownToDoc(input: string): any {
  return JSON.parse(_convertMarkdownToDoc!(input));
}

export function convertMarkdownToHtml(input: string): string {
  return _convertMarkdownToHtml!(input);
}



// TODO what are all of these things vvv

let sendCommandToJSList: Array<(value: any) => void> = [];

export function sendCommandToJS(msg: any) {
  // Called from wasm.
  sendCommandToJSList.forEach(handler => handler(msg));
}

let forwardWasmTaskCallback: any = null;

export function getForwardWasmTaskCallback(): any {
  return forwardWasmTaskCallback;
}

export function setForwardWasmTaskCallback(value: any) {
  forwardWasmTaskCallback = value;
}

export function forwardWasmTask(msg: any) {
  if (forwardWasmTaskCallback) {
    forwardWasmTaskCallback(msg);
  }
}

// ^^^^^


export class WasmError extends Error {
  constructor(e: Error, message: any) {
    super(message);

    // Set the prototype explicitly.
    this.name = 'WasmError';
    this.message = message;
    this.stack = message + ' ' + e.stack;
    Object.setPrototypeOf(this, WasmError.prototype);
  }
}

export class WasmController implements ControllerImpl {
  // public
  onMessage: (msg: any) => void | null;
  onClose: () => void | null; // unused
  onError: (err: any) => void | null;

  // TODO refactor wasmClient, remove Module
  Module: any;
  clientBindings: WasmClientModule;

  sendCommand(command: ControllerCommand) {
    if (forwardWasmTaskCallback != null) {
      if (CONFIG.console_command_log) {
        console.groupCollapsed('%c[controller] %s', 'background: #c63; padding: 3px 5px; display: block; color: white;', command.tag);
        console.debug(command);
        console.groupEnd();
      }

      try {
        this.clientBindings.command(JSON.stringify({
          ControllerCommand: command,
        }));
      } catch (e) {
        this.onError ? this.onError(e) : null;
        throw e;
      }
    }
  }

  // Wasm connector.
  connect(onError: () => void): Promise<void> {
    const client = this;

    return new Promise((resolve, reject) => {
      sendCommandToJSList.push((data) => {
        // Parse the packet.
        let parse: FrontendCommand = JSON.parse(data);

        if (parse.tag == 'ServerCommand') {
          console.error('Did not expect server command:', parse);
        } else {
          if (CONFIG.console_command_log) {
            console.groupCollapsed('[frontend]', parse.tag);
            console.debug(parse);
            console.debug(data);
            console.groupEnd();
          }

          if (client.onMessage != null) {
            client.onMessage(parse);
          }
        }
      });

      index.getWasmModule()
      .then(Module => {
        let clientBindings = Module.wasm_setup(route.serverUrl());
        DEBUG.setGlobalClientBindings(clientBindings);

        // Websocket port
        client.Module = Module;
        client.clientBindings = clientBindings;

        forwardWasmTaskCallback = (msg: any) => {
          try {
            clientBindings.command(msg);
          } catch (e) {
            forwardWasmTaskCallback = null;

            onError();

            throw new WasmError(e, `Error during client command: ${e.message}`);
          }
        };

        resolve();
      });
    });
  }
}