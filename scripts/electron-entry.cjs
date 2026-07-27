const fs = require('node:fs')
const path = require('node:path')
const { app, dialog } = require('electron')

const appPath = path.resolve(__dirname, '..', 'app')
const mainPath = path.join(appPath, 'dist', 'main.js')

if (!fs.existsSync(mainPath)) {
    dialog.showErrorBox(
        'Ferrum is not built',
        'Run `npm run build` before starting Ferrum.',
    )
    app.exit(1)
} else {
    app.setAppPath(appPath)
    require(mainPath)
}
