import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'art/trail-scene.svg')
const targets = [
  resolve(root, 'public/trail-scene.svg'),
  resolve(root, 'site/trail-scene.svg'),
]

await Promise.all(targets.map(async target => {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}))
