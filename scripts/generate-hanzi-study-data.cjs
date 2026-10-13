const fs = require('node:fs')
const vm = require('node:vm')

const sourcePath = 'public/hanzi-study/js/lib/dataList.js'
const outputPath = 'public/hanzi-study/hanzi-data.json'

const context = { window: {} }
vm.createContext(context)
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context)

const source = context.window.dataList
if (!Array.isArray(source)) throw new Error('window.dataList was not loaded')

const seen = new Set()
const entries = []
for (const item of source) {
  const character = String(item.w ?? '').trim()
  if (!character || seen.has(character)) continue
  seen.add(character)
  entries.push({
    id: entries.length + 1,
    character,
    pinyin: String(item.y ?? '').trim(),
    word: String(item.p ?? '').trim(),
    sentence: String(item.s ?? '').trim(),
  })
}

fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`)
console.log(`Generated ${entries.length} unique Hanzi entries from ${source.length} source rows.`)
