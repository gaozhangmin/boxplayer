import fs from 'node:fs'
import semver from 'semver'

process.env.TZ = 'Asia/Shanghai'
const packageJsonStr = fs.readFileSync('./package.json').toString()
try {
  const packageJson = JSON.parse(packageJsonStr)
  const parsed = semver.parse(packageJson.version)
  if (!parsed) {
    throw new Error(`Invalid package version: ${packageJson.version}`)
  }
  packageJson.version = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
  console.info('版本升级为' + packageJson.version)
  fs.writeFileSync('./package.json', JSON.stringify(packageJson, null, 2) + '\n')
} catch (e) {
  console.error('处理package.json失败，请重试', e.message)
  process.exit(1)
}
