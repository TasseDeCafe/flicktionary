import { rootOrpcContract } from '@template-app/api-client/orpc-contracts/root-contract'

type ContractNode = {
  [key: string]: unknown
  '~orpc'?: {
    route?: {
      path?: string
    }
  }
}

export const collectContractPaths = (contract: unknown): string[] => {
  const visited = new Set<ContractNode>()
  const paths = new Set<string>()
  const stack: unknown[] = [contract]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') {
      continue
    }

    const node = current as ContractNode

    if (visited.has(node)) {
      continue
    }

    visited.add(node)

    const routePath = node['~orpc']?.route?.path

    if (typeof routePath === 'string') {
      paths.add(routePath)
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '~orpc') {
        continue
      }

      if (value && typeof value === 'object') {
        stack.push(value)
      }
    }
  }

  return Array.from(paths)
}

export const orpcRelativePaths = collectContractPaths(rootOrpcContract)

export const extractStaticPrefixes = (paths: string[]): string[] => {
  const prefixes = new Set<string>()

  paths.forEach((path) => {
    if (!path) return
    const normalized = path.startsWith('/') ? path : `/${path}`
    const segments = normalized.split('/').filter(Boolean)
    if (segments.length === 0) return

    const staticSegments: string[] = []
    for (const segment of segments) {
      if (segment.startsWith('{') && segment.endsWith('}')) break
      if (segment.startsWith(':')) break
      staticSegments.push(segment)
    }

    if (staticSegments.length === 0) {
      prefixes.add('/')
      return
    }

    prefixes.add(`/${staticSegments.join('/')}`)
  })

  return Array.from(prefixes)
}
