const { createRequire } = require('node:module')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { builtinModules } = require('node:module')
const asar = createRequire(require.resolve('electron-builder'))('@electron/asar')
const required = ['aria2-lib', '@motrix/nat-api']

function verifyDownloadRuntime(archive) {
  if (!existsSync(archive)) throw new Error(`Missing packaged application: ${archive}`)
  asar.uncache(archive)
  const files = new Set(asar.listPackage(archive).map(file => file.replace(/\\/g, '/').replace(/^\/+/, '')))
  const visited = new Set()
  const locate = (name, from) => {
    let directory = from
    while (true) {
      const candidate = path.posix.join(directory, 'node_modules', name)
      if (files.has(candidate + '/package.json')) return candidate
      if (!directory) break
      const parent = path.posix.dirname(directory)
      directory = parent === '.' ? '' : parent
    }
    throw new Error(`Packaged download runtime missing dependency ${name} (required by ${from || 'application'})`)
  }
  function visit(name, from = '') {
    if (builtinModules.includes(name) || name.startsWith('node:')) return
    const directory = locate(name, from)
    if (visited.has(directory)) return
    visited.add(directory)
    const pkg = JSON.parse(asar.extractFile(archive, path.normalize(directory + '/package.json')).toString())
    const entry = path.posix.join(directory, pkg.main || 'index.js')
    if (![entry, entry + '.js', entry + '.json', entry + '/index.js'].some(file => files.has(file))) {
      throw new Error(`Packaged download runtime missing entry point ${entry}`)
    }
    for (const dependency of Object.keys(pkg.dependencies || {})) {
      if (!(dependency in (pkg.optionalDependencies || {}))) visit(dependency, directory)
    }
  }
  required.forEach(name => visit(name))
  return [...visited]
}
module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const packages = verifyDownloadRuntime(path.join(resources, 'app.asar'))
  console.log(`Verified packaged download runtime: ${packages.length} packages`)
}
module.exports.verifyDownloadRuntime = verifyDownloadRuntime
