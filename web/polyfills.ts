/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-extraneous-class */

import './polyfills.buffer'
import { Duplex } from 'stream-browserify'

const Ferrum = window['Ferrum']

export class SocketProxy extends Duplex {
    socket: any

    constructor (...args: any[]) {
        super({
            allowHalfOpen: false,
        })
        this.socket = window['__connector__'].createSocket(...args)
        this.socket.connect$.subscribe(() => this['emit']('connect'))
        this.socket.data$.subscribe(data => this['emit']('data', Buffer.from(data)))
        this.socket.error$.subscribe(error => this['emit']('error', error))
    }

    connect (...args: any[]) {
        this.socket.connect(...args)
    }

    setNoDelay () { }

    setTimeout () { }

    _read (_size: number): void { }

    _write (chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
        this.socket.write(chunk)
        callback()
    }

    _destroy (error: Error|null, callback: (error: Error|null) => void): void {
        this.socket.close(error)
        callback(error)
    }
}

Ferrum.registerMock('fs', {
    rmdirSync: () => null,
    realpathSync: () => null,
    readdir: () => null,
    stat: () => null,
    appendFile: () => null,
    constants: {},
})
Ferrum.registerMock('fs/promises', {})
Ferrum.registerMock('tls', {})
Ferrum.registerMock('module', {
    globalPaths: [],
    prototype: { require: window['require'] },
})

Ferrum.registerMock('http', {
    Agent: class {},
    request: {},
})
Ferrum.registerMock('https', {
    Agent: class {},
    request: {},
})
Ferrum.registerMock('querystring', {})
Ferrum.registerMock('tty', { isatty: () => false })
Ferrum.registerMock('child_process', {})
Ferrum.registerMock('readable-stream', {})
Ferrum.registerMock('os', {
    arch: () => 'web',
    platform: () => 'web',
    homedir: () => '/home',
    tmpdir: () => '/tmp',
    constants: {
        errno: {},
    },
})
Ferrum.registerModule('buffer', {
    Buffer: window['Buffer'],
})
Ferrum.registerModule('crypto', {
    ...require('crypto-browserify'),
    getHashes () {
        return ['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'md5', 'rmd160']
    },
    timingSafeEqual (a, b) {
        return a.equals(b)
    },
})
Ferrum.registerMock('dns', {})
Ferrum.registerMock('@luminati-io/socksv5', {})
Ferrum.registerMock('util', require('util/'))
Ferrum.registerMock('keytar', {
    getPassword: () => null,
})
Ferrum.registerMock('@serialport/bindings', {})
Ferrum.registerMock('@serialport/bindings-cpp', {})
Ferrum.registerMock('tmp', {})

Ferrum.registerModule('net', {
    Socket: SocketProxy,
})
Ferrum.registerModule('events', require('events'))
Ferrum.registerModule('path', require('path-browserify'))
Ferrum.registerModule('url', {
    ...require('url'),
    pathToFileURL: x => `file://${x}`,
})
Ferrum.registerModule('zlib', {
    ...require('browserify-zlib'),
    constants: require('browserify-zlib'),
})
Ferrum.registerModule('assert', Object.assign(
    require('assert'),
    {
        assertNotStrictEqual: () => true,
        notStrictEqual: () => true,
    },
))
Ferrum.registerModule('constants', require('constants-browserify'))
Ferrum.registerModule('stream', require('stream-browserify'))
Ferrum.registerModule('readline', {
    ...require('readline-browserify'),
    cursorTo: () => null,
    clearLine: stream => stream.write('\r'),
})

Ferrum.registerModule('@angular/core', require('@angular/core'))
Ferrum.registerModule('@angular/cdk', require('@angular/cdk'))
Ferrum.registerModule('@angular/cdk/clipboard', require('@angular/cdk/clipboard'))
Ferrum.registerModule('@angular/cdk/drag-drop', require('@angular/cdk/drag-drop'))
Ferrum.registerModule('@angular/compiler', require('@angular/compiler'))
Ferrum.registerModule('@angular/common', require('@angular/common'))
Ferrum.registerModule('@angular/forms', require('@angular/forms'))
Ferrum.registerModule('@angular/platform-browser', require('@angular/platform-browser'))
Ferrum.registerModule('@angular/platform-browser/animations', require('@angular/platform-browser/animations'))
Ferrum.registerModule('@angular/platform-browser-dynamic', require('@angular/platform-browser-dynamic'))
Ferrum.registerModule('@angular/animations', require('@angular/animations'))
Ferrum.registerModule('@angular/localize', require('@angular/localize'))
Ferrum.registerModule('@angular/localize/init', require('@angular/localize/init'))
Ferrum.registerModule('@ng-bootstrap/ng-bootstrap', require('@ng-bootstrap/ng-bootstrap'))
Ferrum.registerModule('ngx-toastr', require('ngx-toastr'))
Ferrum.registerModule('deepmerge', require('deepmerge'))
Ferrum.registerModule('rxjs', require('rxjs'))
Ferrum.registerModule('rxjs/operators', require('rxjs'))
Ferrum.registerModule('string_decoder', require('string_decoder'))
Ferrum.registerModule('js-yaml', require('js-yaml'))
Ferrum.registerModule('zone.js/dist/zone.js', require('zone.js'))
Ferrum.registerModule('zone.js', require('zone.js'))
Ferrum.registerModule('any-promise', require('any-promise'))

Object.assign(window, {
    __dirname: '__dirname',
    setImmediate: setTimeout as any,
})

process.addListener = () => null
