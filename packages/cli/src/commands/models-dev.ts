import { Command } from 'commander'
import { withGracefulShutdown, createPathMap, type PathMap } from '../common.ts'
import path from 'node:path'
import fs from 'node:fs/promises'

export const modelsDev = new Command('models-dev')

modelsDev.command('providers').action(() =>
  withGracefulShutdown(async signal => {
    const pathMap = await createPathMap()
    const data = await fetchData({ signal, pathMap })
    const providers = Object.keys(data).toSorted()
    console.log(JSON.stringify(providers, null, 2))
  }),
)

modelsDev
  .command('models')
  .argument('<provider>')
  .action(provider =>
    withGracefulShutdown(async signal => {
      const pathMap = await createPathMap()
      const data = await fetchData({ signal, pathMap })
      const providerData = data[provider] ?? {}
      const models = Object.keys(providerData.models ?? {}).toSorted()
      console.log(JSON.stringify(models, null, 2))
    }),
  )

modelsDev
  .command('model')
  .argument('<provider>')
  .argument('<model>')
  .action((provider, model) =>
    withGracefulShutdown(async signal => {
      const pathMap = await createPathMap()
      const data = await fetchData({ signal, pathMap })
      const providerData = data[provider] ?? {}
      const modelData = providerData.models?.[model] ?? {}
      console.log(JSON.stringify(modelData, null, 2))
    }),
  )

type Metadata = { etag?: string }

async function fetchData(input: {
  signal: AbortSignal
  pathMap: PathMap
  attempt?: number
  maxAttempts?: number
}): Promise<Record<string, any>> {
  const { signal, pathMap, attempt = 1, maxAttempts = 3 } = input

  if (attempt > maxAttempts) {
    throw new Error(`Failed to fetch models after ${maxAttempts} attempts.`)
  }

  const { repoRoot } = pathMap
  const configDir = path.join(repoRoot, '.nailed-it')
  const metadataPath = path.join(configDir, 'models-dev-metadata.json')
  const dataPath = path.join(configDir, 'models-dev-data.json')

  let metadata: Metadata = {}
  try {
    const content = await fs.readFile(metadataPath, 'utf8')
    metadata = JSON.parse(content) as Metadata
  } catch {
    await fs.rm(metadataPath, { force: true })
  }

  let headers: Record<string, string> = {}
  if (metadata.etag) {
    headers['If-None-Match'] = metadata.etag
  }

  const response = await fetch('https://models.dev/api.json', {
    signal,
    headers,
  })

  if (response.status === 304) {
    let data: Record<string, any> = {}
    try {
      const content = await fs.readFile(dataPath, 'utf8')
      data = JSON.parse(content)
    } catch {
      await fs.rm(dataPath, { force: true })
      await fs.rm(metadataPath, { force: true })
      return await fetchData({
        signal,
        pathMap,
        attempt: attempt + 1,
        maxAttempts,
      })
    }

    console.error('Models are up to date.')
    return data
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to fetch models: ${response.status} ${response.statusText} - ${text}`,
    )
  }

  let newMetadata: Metadata = {}
  const etag = response.headers.get('etag')
  if (etag) {
    newMetadata.etag = etag
  }

  const data = await response.json()

  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(dataPath, JSON.stringify(data, null, 2))
  await fs.writeFile(metadataPath, JSON.stringify(newMetadata, null, 2))

  console.error('Models updated successfully.')
  return data
}
