import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const PERMISSIONS = new Set(['read', 'navigate', 'write', 'destructive'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

/** Tool registrations are object literals with description, inputSchema and execute. */
function toolRegistrations(file: string): Array<{ name: string; line: number; permission?: string }> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const tools: Array<{ name: string; line: number; permission?: string }> = []
  const record = (name: string, value: ts.Expression) => {
    if (!ts.isObjectLiteralExpression(value)) return
    const props = new Map(value.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(source), prop.initializer]))
    if (!props.has('description') || !props.has('inputSchema') || !props.has('execute')) return
    const permission = props.get('permission')
    tools.push({ name, line: source.getLineAndCharacterOfPosition(value.getStart()).line + 1, permission: permission && ts.isStringLiteral(permission) ? permission.text : permission?.getText(source) })
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) record(node.name.getText(source), node.initializer)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) record(node.left.name.text, node.right)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return tools
}

describe('Agent tool permissions', () => {
  const agentSurfaces = sourceFiles(join(root, 'src')).filter(file => /\brunBoxPlayerAgent\(/.test(readFileSync(file, 'utf8')) && !file.endsWith(join('services', 'agent', 'session.ts')))

  it('finds every Agent surface that registers tools', () => {
    expect(agentSurfaces.map(file => relative(root, file)).sort()).toEqual([
      'src/layout/aisearch/useAISearchChat.ts',
      'src/services/documents/index.ts',
      'src/services/reedy/ReedyAgent.ts',
      'src/services/workspaceAgent/runner.ts'
    ])
  })

  it('declares an explicit permission on every registered tool', () => {
    const undeclared = agentSurfaces.flatMap(file => toolRegistrations(file)
      .filter(tool => !tool.permission || !PERMISSIONS.has(tool.permission))
      .map(tool => `${relative(root, file)}:${tool.line} ${tool.name} (${tool.permission || 'missing'})`))
    expect(undeclared).toEqual([])
    expect(agentSurfaces.flatMap(toolRegistrations).length).toBeGreaterThan(30)
  })
})
