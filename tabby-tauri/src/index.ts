import { Injectable, NgModule } from '@angular/core'
import { ChildProcess, PTYInterface, PTYProxy, Shell, ShellProvider } from 'tabby-local'

type Unlisten = () => void

interface TauriEvent<T> {
    payload: T
}

interface TauriGlobal {
    core: {
        invoke<T> (command: string, args?: Record<string, unknown>): Promise<T>
    }
    event: {
        listen<T> (event: string, handler: (event: TauriEvent<T>) => void): Promise<Unlisten>
    }
}

declare global {
    interface Window {
        __TAURI__: TauriGlobal
    }
}

function tauri (): TauriGlobal {
    if (!window.__TAURI__) {
        throw new Error('The Tauri bridge is unavailable')
    }
    return window.__TAURI__
}

interface SpawnResult {
    id: string
    pid: number
}

@Injectable()
export class TauriPTYInterface extends PTYInterface {
    async spawn (command: string, args: string[], options: any): Promise<PTYProxy> {
        const result = await tauri().core.invoke<SpawnResult>('pty_spawn', {
            request: {
                command,
                args,
                cwd: options.cwd ?? null,
                env: options.env ?? {},
                cols: options.cols ?? 80,
                rows: options.rows ?? 30,
            },
        })
        return new TauriPTYProxy(result.id, result.pid, options.cwd ?? null)
    }

    async restore (_id: string): Promise<PTYProxy|null> {
        // Tauri sessions currently live for the lifetime of their WebView.
        // Persisted PTY recovery is the next host-parity milestone.
        return null
    }
}

export class TauriPTYProxy extends PTYProxy {
    private unlisteners: Promise<Unlisten>[] = []

    constructor (
        private id: string,
        private pid: number,
        private cwd: string|null,
    ) {
        super()
    }

    getID (): string {
        return this.id
    }

    async getPID (): Promise<number> {
        return this.pid
    }

    async getTruePID (): Promise<number> {
        return this.pid
    }

    async resize (columns: number, rows: number): Promise<void> {
        await tauri().core.invoke('pty_resize', { id: this.id, columns, rows })
    }

    async write (data: Buffer): Promise<void> {
        await tauri().core.invoke('pty_write', { id: this.id, data: Array.from(data) })
    }

    async kill (_signal?: string): Promise<void> {
        await tauri().core.invoke('pty_kill', { id: this.id })
    }

    ackData (_length: number): void {
        // Tauri event delivery is already back-pressured by the IPC transport.
    }

    subscribe (event: string, handler: (...args: any[]) => void): void {
        const eventName = `pty:${this.id}:${event}`
        this.unlisteners.push(tauri().event.listen(eventName, message => {
            if (event === 'data') {
                handler(Uint8Array.from(message.payload as number[]))
            } else {
                handler(message.payload)
            }
        }))
    }

    unsubscribeAll (): void {
        for (const unlisten of this.unlisteners) {
            unlisten.then(dispose => dispose())
        }
        this.unlisteners = []
    }

    async getChildProcesses (): Promise<ChildProcess[]> {
        return []
    }

    async getWorkingDirectory (): Promise<string|null> {
        return this.cwd
    }
}

@Injectable()
export class TauriShellProvider extends ShellProvider {
    async provide (): Promise<Shell[]> {
        const shell = await tauri().core.invoke<string>('default_shell')
        return [{
            id: 'tauri-default',
            name: 'System default',
            command: shell,
            args: [],
            env: {},
            shellType: 'unix',
        }]
    }
}

@NgModule({
    providers: [
        { provide: PTYInterface, useClass: TauriPTYInterface },
        { provide: ShellProvider, useClass: TauriShellProvider, multi: true },
    ],
})
export default class TauriHostModule { }
